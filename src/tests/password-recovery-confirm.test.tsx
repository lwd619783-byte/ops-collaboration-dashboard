import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ConfirmPasswordRecoveryPage } from '@/pages/auth/ConfirmPasswordRecoveryPage'
import type { Database } from '@/types/database.generated'

const RECOVERY_MARKER = 'ops-auth-recovery-session'
const FIXTURE_TOKEN_HASH = 'fixture-recovery-token-hash-not-a-real-secret'

function renderRecoveryPage(
  verifyOtp: ReturnType<typeof vi.fn>,
  initialEntry = `/auth/recovery?token_hash=${encodeURIComponent(FIXTURE_TOKEN_HASH)}&type=recovery`,
) {
  const client = {
    auth: { verifyOtp },
  } as unknown as SupabaseClient<Database>

  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
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
    </MemoryRouter>,
  )
}

describe('密码重置 TokenHash 确认页', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('仅打开邮件落地页不会自动消费一次性 token', async () => {
    const verifyOtp = vi.fn()
    renderRecoveryPage(verifyOtp)

    expect(
      await screen.findByRole('heading', { level: 2, name: '确认密码重置' }),
    ).toBeInTheDocument()
    expect(verifyOtp).not.toHaveBeenCalled()
    expect(document.body).not.toHaveTextContent(FIXTURE_TOKEN_HASH)
    expect(window.sessionStorage.getItem(RECOVERY_MARKER)).toBeNull()
  })

  it('用户主动确认后使用 recovery TokenHash 建立会话并进入重置页', async () => {
    const verifyOtp = vi.fn(async () => ({
      data: {
        user: { id: 'fixture-auth-user' },
        session: { access_token: 'fixture-access-token' },
      },
      error: null,
    }))
    renderRecoveryPage(verifyOtp)

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: '继续重置密码' }),
    )

    expect(verifyOtp).toHaveBeenCalledTimes(1)
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: FIXTURE_TOKEN_HASH,
      type: 'recovery',
    })
    expect(window.sessionStorage.getItem(RECOVERY_MARKER)).toBe('1')
    expect(
      await screen.findByText('recovery destination reached'),
    ).toBeInTheDocument()
  })

  it('缺少或伪造 recovery 参数时不调用 Supabase 验证', async () => {
    const verifyOtp = vi.fn()
    renderRecoveryPage(
      verifyOtp,
      `/auth/recovery?token_hash=${encodeURIComponent(FIXTURE_TOKEN_HASH)}&type=email`,
    )

    expect(
      await screen.findByText('重置密码链接无效，请重新申请。'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '继续重置密码' }),
    ).not.toBeInTheDocument()
    expect(verifyOtp).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(RECOVERY_MARKER)).toBeNull()
  })

  it('过期 token 显示安全错误且不建立 recovery 标记', async () => {
    const verifyOtp = vi.fn(async () => ({
      data: { user: null, session: null },
      error: {
        code: 'otp_expired',
        message: 'raw provider detail must stay hidden',
        name: 'AuthApiError',
        status: 403,
      },
    }))
    renderRecoveryPage(verifyOtp)

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: '继续重置密码' }),
    )

    expect(
      await screen.findByText('重置密码链接已过期，请重新申请。'),
    ).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('raw provider detail')
    expect(window.sessionStorage.getItem(RECOVERY_MARKER)).toBeNull()
  })
})
