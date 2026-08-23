import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, Route, RouterProvider, Routes } from 'react-router'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AppRouter } from '@/app/router/AppRouter'
import { ConfirmPasswordRecoveryPage } from '@/pages/auth/ConfirmPasswordRecoveryPage'
import { RECOVERY_SESSION_STORAGE_KEY } from '@/features/auth/authService'
import { createSupabaseClientMock } from '@/tests/helpers/supabaseAuthMock'
import type { Database } from '@/types/database.generated'

const FIXTURE_TOKEN_HASH = 'fixture-recovery-token-hash-not-a-real-secret'
const RECOVERY_ENTRY = `/auth/recovery#token_hash=${encodeURIComponent(FIXTURE_TOKEN_HASH)}&type=recovery`

function renderConfirmationOnly(
  verifyOtp: ReturnType<typeof vi.fn>,
  initialEntry = RECOVERY_ENTRY,
) {
  const client = {
    auth: { verifyOtp },
  } as unknown as SupabaseClient<Database>

  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <Routes>
            <Route
              path="/auth/recovery"
              element={
                <ConfirmPasswordRecoveryPage
                  resolveClient={() => ({ status: 'ready', client })}
                />
              }
            />
            <Route
              path="/reset-password"
              element={<p>recovery destination reached</p>}
            />
          </Routes>
        ),
      },
    ],
    { initialEntries: [initialEntry] },
  )

  render(<RouterProvider router={router} />)
  return { router }
}

function renderCompleteRecoveryFlow() {
  const supabase = createSupabaseClientMock({ hasSession: false })
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <AppRouter
            resolveClient={() => ({ status: 'ready', client: supabase.client })}
          />
        ),
      },
    ],
    { initialEntries: [RECOVERY_ENTRY] },
  )

  render(<RouterProvider router={router} />)
  return { router, supabase }
}

describe('密码重置 TokenHash 确认边界', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('仅打开邮件落地页不会消费 token，并立即从地址状态清除 fragment', async () => {
    const verifyOtp = vi.fn()
    const { router } = renderConfirmationOnly(verifyOtp)

    expect(
      await screen.findByRole('heading', { level: 2, name: '确认密码重置' }),
    ).toBeInTheDocument()
    expect(verifyOtp).not.toHaveBeenCalled()
    expect(document.body).not.toHaveTextContent(FIXTURE_TOKEN_HASH)
    expect(
      window.sessionStorage.getItem(RECOVERY_SESSION_STORAGE_KEY),
    ).toBeNull()

    await waitFor(() => expect(router.state.location.hash).toBe(''))
    expect(router.state.location.search).toBe('')
    expect(router.state.location.pathname).toBe('/auth/recovery')
  })

  it('用户主动确认后以 recovery TokenHash 验证，不依赖旧 PKCE 回调事件', async () => {
    const verifyOtp = vi.fn(async () => ({
      data: {
        user: { id: 'fixture-auth-user' },
        session: { access_token: 'fixture-access-token' },
      },
      error: null,
    }))
    const { router } = renderConfirmationOnly(verifyOtp)

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: '继续重置密码' }),
    )

    expect(verifyOtp).toHaveBeenCalledTimes(1)
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: FIXTURE_TOKEN_HASH,
      type: 'recovery',
    })
    expect(window.sessionStorage.getItem(RECOVERY_SESSION_STORAGE_KEY)).toBe(
      '1',
    )
    expect(router.state.location.pathname).toBe('/reset-password')
    expect(router.state.location.hash).toBe('')
    expect(
      await screen.findByText('recovery destination reached'),
    ).toBeInTheDocument()
  })

  it('缺少或伪造 recovery fragment 时不调用 Supabase 验证', async () => {
    const verifyOtp = vi.fn()
    renderConfirmationOnly(
      verifyOtp,
      `/auth/recovery#token_hash=${encodeURIComponent(FIXTURE_TOKEN_HASH)}&type=email`,
    )

    expect(
      await screen.findByText(
        '此重置链接已失效，可能已过期、已使用或不是最新一封邮件中的链接，请重新申请。',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '继续重置密码' }),
    ).not.toBeInTheDocument()
    expect(verifyOtp).not.toHaveBeenCalled()
    expect(
      window.sessionStorage.getItem(RECOVERY_SESSION_STORAGE_KEY),
    ).toBeNull()
  })

  it('Supabase 拒绝已失效 token 时不泄露原始错误，也不建立 recovery 标记', async () => {
    const verifyOtp = vi.fn(async () => ({
      data: { user: null, session: null },
      error: {
        code: 'otp_expired',
        message: 'raw provider detail must stay hidden',
        name: 'AuthApiError',
        status: 403,
      },
    }))
    renderConfirmationOnly(verifyOtp)

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: '继续重置密码' }),
    )

    expect(
      await screen.findByText(
        '此重置链接已失效，可能已过期、已使用或不是最新一封邮件中的链接，请重新申请。',
      ),
    ).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('raw provider detail')
    expect(
      window.sessionStorage.getItem(RECOVERY_SESSION_STORAGE_KEY),
    ).toBeNull()
  })

  it('验证网络失败与失效链接使用不同安全错误', async () => {
    const verifyOtp = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    renderConfirmationOnly(verifyOtp)

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: '继续重置密码' }),
    )

    expect(
      await screen.findByText('网络连接不可用，请检查网络后重试。'),
    ).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Failed to fetch')
  })
})

describe('密码重置 TokenHash 完整链路', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('TokenHash 建立 session 后无需 PASSWORD_RECOVERY 事件即可更新密码并安全退出', async () => {
    const { router, supabase } = renderCompleteRecoveryFlow()
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole('button', { name: '继续重置密码' }),
    )

    expect(supabase.verifyOtp).toHaveBeenCalledWith({
      token_hash: FIXTURE_TOKEN_HASH,
      type: 'recovery',
    })
    expect(window.sessionStorage.getItem(RECOVERY_SESSION_STORAGE_KEY)).toBe(
      '1',
    )

    const password = await screen.findByLabelText('新密码')
    const confirmation = screen.getByLabelText('确认新密码')
    await user.type(password, 'new-password-123')
    await user.type(confirmation, 'new-password-123')
    await user.click(screen.getByRole('button', { name: '更新密码' }))

    expect(supabase.updateUser).toHaveBeenCalledWith({
      password: 'new-password-123',
    })
    await waitFor(() =>
      expect(
        window.sessionStorage.getItem(RECOVERY_SESSION_STORAGE_KEY),
      ).toBeNull(),
    )
    expect(supabase.signOut).toHaveBeenCalledWith({ scope: 'local' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.hash).toBe('')
    expect(router.state.location.search).toBe('')
  })

  it('直接进入 reset-password 且没有恢复会话时明确报告 recovery context 缺失', async () => {
    const supabase = createSupabaseClientMock({ hasSession: false })
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <AppRouter
              resolveClient={() => ({
                status: 'ready',
                client: supabase.client,
              })}
            />
          ),
        },
      ],
      { initialEntries: ['/reset-password'] },
    )
    render(<RouterProvider router={router} />)

    expect(
      await screen.findByText(
        '当前浏览器没有有效的密码恢复会话，请从最新一封密码重置邮件重新进入。',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument()
  })
})
