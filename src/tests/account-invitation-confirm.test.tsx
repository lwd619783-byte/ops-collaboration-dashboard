import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, Route, RouterProvider, Routes } from 'react-router'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AppRouter } from '@/app/router/AppRouter'
import {
  ACTIVATION_PHASE_STORAGE_KEY,
  RECOVERY_SESSION_STORAGE_KEY,
} from '@/features/auth/authService'
import { ConfirmAccountInvitationPage } from '@/pages/auth/ConfirmAccountInvitationPage'
import {
  createSupabaseClientMock,
  FICTIONAL_APP_USER_ID,
  fictionalWorkspace,
} from '@/tests/helpers/supabaseAuthMock'
import type { Database } from '@/types/database.generated'

const FIXTURE_TOKEN_HASH = 'fixture-invite-token-hash-not-a-real-secret'
const INVITE_ENTRY = `/auth/invite#token_hash=${encodeURIComponent(FIXTURE_TOKEN_HASH)}&type=invite`

const invitation = {
  invitation_id: '88888888-8888-4888-8888-888888888888',
  workspace_id: '77777777-7777-4777-8777-777777777777',
  workspace_name: '受邀工作空间',
  role: 'member' as const,
  status: 'sent' as const,
  expires_at: '2026-09-09T00:00:00+00:00',
}

function renderConfirmationOnly(
  verifyOtp: ReturnType<typeof vi.fn>,
  initialEntry = INVITE_ENTRY,
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
              path="/auth/invite"
              element={
                <ConfirmAccountInvitationPage
                  resolveClient={() => ({ status: 'ready', client })}
                />
              }
            />
            <Route
              path="/activate-account"
              element={<p>activation destination reached</p>}
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

function renderCompleteInviteFlow() {
  const supabase = createSupabaseClientMock({ hasSession: false })
  let accepted = false

  supabase.rpc.mockImplementation(async (name: string) => {
    if (name === 'current_app_user_id') {
      return { data: FICTIONAL_APP_USER_ID, error: null }
    }
    if (name === 'list_my_workspaces') {
      return { data: accepted ? [fictionalWorkspace] : [], error: null }
    }
    if (name === 'list_my_pending_workspace_invitations') {
      return { data: accepted ? [] : [invitation], error: null }
    }
    if (name === 'accept_workspace_invitation') {
      accepted = true
      return { data: [{ already_accepted: false }], error: null }
    }
    return { data: null, error: null }
  })

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
    { initialEntries: [INVITE_ENTRY] },
  )

  render(<RouterProvider router={router} />)
  return { router, supabase }
}

describe('账号邀请 TokenHash 确认边界', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('仅打开邀请落地页不会消费 token，并立即从地址状态清除 fragment', async () => {
    const verifyOtp = vi.fn()
    const { router } = renderConfirmationOnly(verifyOtp)

    expect(
      await screen.findByRole('heading', { level: 2, name: '确认账号邀请' }),
    ).toBeInTheDocument()
    expect(verifyOtp).not.toHaveBeenCalled()
    expect(document.body).not.toHaveTextContent(FIXTURE_TOKEN_HASH)

    await waitFor(() => expect(router.state.location.hash).toBe(''))
    expect(router.state.location.search).toBe('')
    expect(router.state.location.pathname).toBe('/auth/invite')
  })

  it('用户主动确认后以 invite TokenHash 建立会话并清理旧流程标记', async () => {
    const verifyOtp = vi.fn(async () => ({
      data: {
        user: { id: 'fixture-auth-user' },
        session: { access_token: 'fixture-access-token' },
      },
      error: null,
    }))
    window.sessionStorage.setItem(RECOVERY_SESSION_STORAGE_KEY, '1')
    window.sessionStorage.setItem(ACTIVATION_PHASE_STORAGE_KEY, '1')
    const { router } = renderConfirmationOnly(verifyOtp)

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: '继续激活账号' }),
    )

    expect(verifyOtp).toHaveBeenCalledTimes(1)
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: FIXTURE_TOKEN_HASH,
      type: 'invite',
    })
    expect(
      window.sessionStorage.getItem(RECOVERY_SESSION_STORAGE_KEY),
    ).toBeNull()
    expect(
      window.sessionStorage.getItem(ACTIVATION_PHASE_STORAGE_KEY),
    ).toBeNull()
    expect(router.state.location.pathname).toBe('/activate-account')
    expect(router.state.location.hash).toBe('')
    expect(
      await screen.findByText('activation destination reached'),
    ).toBeInTheDocument()
  })

  it('缺少或伪造 invite fragment 时不调用 Supabase 验证', async () => {
    const verifyOtp = vi.fn()
    renderConfirmationOnly(
      verifyOtp,
      `/auth/invite#token_hash=${encodeURIComponent(FIXTURE_TOKEN_HASH)}&type=recovery`,
    )

    expect(
      await screen.findByText(
        '此邀请链接已失效，可能已过期、已使用或不是最新一封邀请邮件中的链接，请联系管理员重新发送邀请。',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '继续激活账号' }),
    ).not.toBeInTheDocument()
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it('Supabase 拒绝已失效 invite token 时使用邀请专用安全文案且不泄露原始错误', async () => {
    const verifyOtp = vi.fn(async () => ({
      data: { user: null, session: null },
      error: {
        code: 'otp_expired',
        message: 'raw provider invite detail must stay hidden',
        name: 'AuthApiError',
        status: 403,
      },
    }))
    renderConfirmationOnly(verifyOtp)

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: '继续激活账号' }),
    )

    expect(
      await screen.findByText(
        '此邀请链接已失效，可能已过期、已使用或不是最新一封邀请邮件中的链接，请联系管理员重新发送邀请。',
      ),
    ).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('raw provider invite detail')
  })

  it('验证网络失败使用通用网络安全错误', async () => {
    const verifyOtp = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    renderConfirmationOnly(verifyOtp)

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: '继续激活账号' }),
    )

    expect(
      await screen.findByText('网络连接不可用，请检查网络后重试。'),
    ).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Failed to fetch')
  })
})

describe('ISSUE-004 邀请单次设密完整链路', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('Invite TokenHash → 主动确认 → 一次设密 → 接受邀请 → 退出 → 新密码登录', async () => {
    const { router, supabase } = renderCompleteInviteFlow()
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole('button', { name: '继续激活账号' }),
    )

    expect(supabase.verifyOtp).toHaveBeenCalledTimes(1)
    expect(supabase.verifyOtp).toHaveBeenCalledWith({
      token_hash: FIXTURE_TOKEN_HASH,
      type: 'invite',
    })
    expect(router.state.location.pathname).toBe('/activate-account')

    await screen.findByRole('heading', { name: '激活工作空间账号' })
    await user.type(screen.getByLabelText(/设置密码/), 'strong-pass-123')
    await user.type(screen.getByLabelText(/确认密码/), 'strong-pass-123')
    await user.click(
      screen.getByRole('button', { name: '设置密码并接受邀请' }),
    )

    await waitFor(() =>
      expect(supabase.updateUser).toHaveBeenCalledWith({
        password: 'strong-pass-123',
      }),
    )
    expect(supabase.updateUser).toHaveBeenCalledTimes(1)
    expect(supabase.rpc).toHaveBeenCalledWith('accept_workspace_invitation', {
      p_invitation_id: invitation.invitation_id,
    })
    await waitFor(() =>
      expect(supabase.signOut).toHaveBeenCalledWith({ scope: 'local' }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))

    const email = await screen.findByLabelText(/邮箱/)
    const password = screen.getByLabelText(/^密码/)
    await user.type(email, 'invitee@example.invalid')
    await user.type(password, 'strong-pass-123')
    await user.click(screen.getByRole('button', { name: '登录' }))

    expect(supabase.signInWithPassword).toHaveBeenCalledWith({
      email: 'invitee@example.invalid',
      password: 'strong-pass-123',
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(supabase.updateUser).toHaveBeenCalledTimes(1)
  })
})
