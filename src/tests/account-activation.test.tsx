import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/AppRouter'
import {
  createSupabaseClientMock,
  FICTIONAL_APP_USER_ID,
} from '@/tests/helpers/supabaseAuthMock'

const invitation = {
  invitation_id: '88888888-8888-4888-8888-888888888888',
  workspace_id: '77777777-7777-4777-8777-777777777777',
  workspace_name: '受邀工作空间',
  role: 'member' as const,
  status: 'sent' as const,
  expires_at: '2026-08-09T00:00:00+00:00',
}

function activationClient() {
  const supabase = createSupabaseClientMock({
    hasSession: true,
    workspaceRows: [],
    pendingInvitationRows: [invitation],
  })
  return {
    supabase,
    resolveClient: () => ({
      status: 'ready' as const,
      client: supabase.client,
    }),
  }
}

describe('首次受邀账户激活', () => {
  it('先设置密码，再接受邀请，最后显式本地退出并回到登录页', async () => {
    const user = userEvent.setup()
    const { supabase, resolveClient } = activationClient()
    supabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'current_app_user_id') {
        return { data: FICTIONAL_APP_USER_ID, error: null }
      }
      if (name === 'list_my_workspaces') return { data: [], error: null }
      if (name === 'list_my_pending_workspace_invitations') {
        return { data: [invitation], error: null }
      }
      if (name === 'accept_workspace_invitation') {
        return { data: [{ already_accepted: false }], error: null }
      }
      return { data: null, error: null }
    })
    render(
      <MemoryRouter initialEntries={['/activate-account']}>
        <AppRouter resolveClient={resolveClient} />
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { name: '激活工作空间账号' })
    await user.type(screen.getByLabelText(/设置密码/), 'strong-pass-123')
    await user.type(screen.getByLabelText(/确认密码/), 'strong-pass-123')
    await user.click(screen.getByRole('button', { name: '设置密码并接受邀请' }))

    await waitFor(() =>
      expect(supabase.updateUser).toHaveBeenCalledWith({
        password: 'strong-pass-123',
      }),
    )
    expect(supabase.rpc).toHaveBeenCalledWith('accept_workspace_invitation', {
      p_invitation_id: invitation.invitation_id,
    })
    await waitFor(() =>
      expect(supabase.signOut).toHaveBeenCalledWith({ scope: 'local' }),
    )
    expect(
      await screen.findByRole('heading', { level: 2, name: '登录' }),
    ).toBeInTheDocument()
  })

  it('密码设置后若邀请接受失败，只重试接受步骤，不重复修改密码', async () => {
    const user = userEvent.setup()
    const { supabase, resolveClient } = activationClient()
    let acceptanceAttempts = 0
    supabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'current_app_user_id') {
        return { data: FICTIONAL_APP_USER_ID, error: null }
      }
      if (name === 'list_my_workspaces') return { data: [], error: null }
      if (name === 'list_my_pending_workspace_invitations') {
        return { data: [invitation], error: null }
      }
      if (name === 'accept_workspace_invitation') {
        acceptanceAttempts += 1
        return acceptanceAttempts === 1
          ? {
              data: null,
              error: { message: 'workspace_invitation_unavailable' },
            }
          : { data: [{ already_accepted: false }], error: null }
      }
      return { data: null, error: null }
    })
    render(
      <MemoryRouter initialEntries={['/activate-account']}>
        <AppRouter resolveClient={resolveClient} />
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { name: '激活工作空间账号' })
    await user.type(screen.getByLabelText(/设置密码/), 'strong-pass-123')
    await user.type(screen.getByLabelText(/确认密码/), 'strong-pass-123')
    await user.click(screen.getByRole('button', { name: '设置密码并接受邀请' }))

    expect(
      await screen.findByText('密码已设置。现在仅重试接受工作空间邀请。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      '密码已设置，但邀请暂未接受。',
    )
    expect(supabase.signOut).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '重试接受邀请' }))
    await waitFor(() => expect(acceptanceAttempts).toBe(2))
    expect(supabase.updateUser).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(supabase.signOut).toHaveBeenCalledTimes(1))
  })

  it('数据库返回邀请已接受时仍按幂等成功完成激活退出', async () => {
    const user = userEvent.setup()
    const { supabase, resolveClient } = activationClient()
    supabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'current_app_user_id') {
        return { data: FICTIONAL_APP_USER_ID, error: null }
      }
      if (name === 'list_my_workspaces') return { data: [], error: null }
      if (name === 'list_my_pending_workspace_invitations') {
        return { data: [invitation], error: null }
      }
      if (name === 'accept_workspace_invitation') {
        return { data: [{ already_accepted: true }], error: null }
      }
      return { data: null, error: null }
    })
    render(
      <MemoryRouter initialEntries={['/activate-account']}>
        <AppRouter resolveClient={resolveClient} />
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { name: '激活工作空间账号' })
    await user.type(screen.getByLabelText(/设置密码/), 'strong-pass-123')
    await user.type(screen.getByLabelText(/确认密码/), 'strong-pass-123')
    await user.click(screen.getByRole('button', { name: '设置密码并接受邀请' }))

    await waitFor(() => expect(supabase.signOut).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByRole('heading', { level: 2, name: '登录' }),
    ).toBeInTheDocument()
  })

  it('过期、撤销、已接受或不属于当前账户的邀请统一显示安全空状态', async () => {
    const supabase = createSupabaseClientMock({
      hasSession: true,
      workspaceRows: [],
      pendingInvitationRows: [],
    })
    render(
      <MemoryRouter initialEntries={['/activate-account']}>
        <AppRouter
          resolveClient={() => ({
            status: 'ready' as const,
            client: supabase.client,
          })}
        />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: '暂无可接受的邀请',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/邀请可能已过期、撤销、接受/)).toBeInTheDocument()
  })

  it('USER_UPDATED 重解析期间不丢失密码已设置状态，重试只调一次密码更新，接受成功后才退出', async () => {
    const user = userEvent.setup()
    const { supabase, resolveClient } = activationClient()
    let identityCalls = 0
    let releaseIdentity: (() => void) | null = null
    let acceptanceAttempts = 0
    supabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'current_app_user_id') {
        identityCalls += 1
        if (identityCalls === 1) {
          return { data: FICTIONAL_APP_USER_ID, error: null }
        }
        // Deferred promise: the USER_UPDATED-triggered identity resolution
        // stays in flight while the activation page is unmounted.
        return new Promise((resolve) => {
          releaseIdentity = () =>
            resolve({ data: FICTIONAL_APP_USER_ID, error: null })
        })
      }
      if (name === 'list_my_workspaces') return { data: [], error: null }
      if (name === 'list_my_pending_workspace_invitations') {
        return { data: [invitation], error: null }
      }
      if (name === 'accept_workspace_invitation') {
        acceptanceAttempts += 1
        return acceptanceAttempts === 1
          ? {
              data: null,
              error: { message: 'workspace_invitation_unavailable' },
            }
          : { data: [{ already_accepted: false }], error: null }
      }
      return { data: null, error: null }
    })
    render(
      <MemoryRouter initialEntries={['/activate-account']}>
        <AppRouter resolveClient={resolveClient} />
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { name: '激活工作空间账号' })
    await user.type(screen.getByLabelText(/设置密码/), 'strong-pass-123')
    await user.type(screen.getByLabelText(/确认密码/), 'strong-pass-123')
    await user.click(screen.getByRole('button', { name: '设置密码并接受邀请' }))

    // The password update succeeded and emitted USER_UPDATED; the first
    // acceptance attempt fails while the identity resolution is deferred.
    await waitFor(() =>
      expect(supabase.updateUser).toHaveBeenCalledWith({
        password: 'strong-pass-123',
      }),
    )
    await waitFor(() => expect(acceptanceAttempts).toBe(1))
    expect(releaseIdentity).not.toBeNull()

    // Release the deferred identity resolution: the activation page remounts
    // and must STILL remember that the password was already set.
    await act(async () => {
      releaseIdentity?.()
    })
    expect(
      await screen.findByText('密码已设置。现在仅重试接受工作空间邀请。'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/设置密码/)).not.toBeInTheDocument()
    expect(supabase.signOut).not.toHaveBeenCalled()

    // Retrying only re-attempts acceptance; updateUser is never called again.
    await user.click(screen.getByRole('button', { name: '重试接受邀请' }))
    await waitFor(() => expect(acceptanceAttempts).toBe(2))
    expect(supabase.updateUser).toHaveBeenCalledTimes(1)

    // The local-scope sign-out happens only after acceptance succeeded.
    await waitFor(() =>
      expect(supabase.signOut).toHaveBeenCalledWith({ scope: 'local' }),
    )
    expect(
      await screen.findByRole('heading', { level: 2, name: '登录' }),
    ).toBeInTheDocument()
  })

  it('页面刷新后仍记住密码已设置（sessionStorage 恢复），不再次要求密码', async () => {
    const user = userEvent.setup()
    const { supabase, resolveClient } = activationClient()
    let acceptanceAttempts = 0
    supabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'current_app_user_id') {
        return { data: FICTIONAL_APP_USER_ID, error: null }
      }
      if (name === 'list_my_workspaces') return { data: [], error: null }
      if (name === 'list_my_pending_workspace_invitations') {
        return { data: [invitation], error: null }
      }
      if (name === 'accept_workspace_invitation') {
        acceptanceAttempts += 1
        return acceptanceAttempts === 1
          ? {
              data: null,
              error: { message: 'workspace_invitation_unavailable' },
            }
          : { data: [{ already_accepted: false }], error: null }
      }
      return { data: null, error: null }
    })
    const renderActivation = () =>
      render(
        <MemoryRouter initialEntries={['/activate-account']}>
          <AppRouter resolveClient={resolveClient} />
        </MemoryRouter>,
      )
    const first = renderActivation()

    await screen.findByRole('heading', { name: '激活工作空间账号' })
    await user.type(screen.getByLabelText(/设置密码/), 'strong-pass-123')
    await user.type(screen.getByLabelText(/确认密码/), 'strong-pass-123')
    await user.click(screen.getByRole('button', { name: '设置密码并接受邀请' }))
    await waitFor(() => expect(acceptanceAttempts).toBe(1))

    // Simulate a page refresh: unmount everything, keep sessionStorage.
    first.unmount()
    renderActivation()

    expect(
      await screen.findByText('密码已设置。现在仅重试接受工作空间邀请。'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/设置密码/)).not.toBeInTheDocument()
    expect(supabase.updateUser).toHaveBeenCalledTimes(1)

    // The recovered phase allows retrying only the acceptance step.
    await user.click(screen.getByRole('button', { name: '重试接受邀请' }))
    await waitFor(() => expect(acceptanceAttempts).toBe(2))
    expect(supabase.updateUser).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(supabase.signOut).toHaveBeenCalledWith({ scope: 'local' }),
    )
  })
})
