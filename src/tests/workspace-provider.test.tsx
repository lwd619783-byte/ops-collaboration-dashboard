import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/AppRouter'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { WorkspaceProvider } from '@/features/workspaces/WorkspaceProvider'
import { useWorkspace } from '@/features/workspaces/WorkspaceContext'
import {
  createSupabaseClientMock,
  FICTIONAL_APP_USER_ID,
  fictionalWorkspace,
} from '@/tests/helpers/supabaseAuthMock'

function providerWrapper(
  resolveClient: ReturnType<typeof readyResolver>,
): ({ children }: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }) {
    return (
      <AuthProvider resolveClient={resolveClient}>
        <WorkspaceProvider resolveClient={resolveClient}>
          {children}
        </WorkspaceProvider>
      </AuthProvider>
    )
  }
}

function readyResolver(supabase: ReturnType<typeof createSupabaseClientMock>) {
  return () => ({ status: 'ready' as const, client: supabase.client })
}

describe('WorkspaceProvider', () => {
  it('加载当前工作空间和待处理邀请，并选择第一个可用工作空间', async () => {
    const supabase = createSupabaseClientMock({
      hasSession: true,
      pendingInvitationRows: [
        {
          invitation_id: '88888888-8888-4888-8888-888888888888',
          workspace_id: '77777777-7777-4777-8777-777777777777',
          workspace_name: '待激活工作空间',
          role: 'member',
          status: 'sent',
          expires_at: '2026-08-09T00:00:00+00:00',
        },
      ],
    })
    const resolveClient = readyResolver(supabase)
    const { result } = renderHook(() => useWorkspace(), {
      wrapper: providerWrapper(resolveClient),
    })

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.currentWorkspace).toEqual(fictionalWorkspace)
    expect(result.current.pendingInvitations).toHaveLength(1)
    expect(supabase.rpc).toHaveBeenCalledWith('list_my_workspaces')
    expect(supabase.rpc).toHaveBeenCalledWith(
      'list_my_pending_workspace_invitations',
    )
  })

  it('将工作空间读取失败映射为安全错误，并允许显式重试', async () => {
    const supabase = createSupabaseClientMock({ hasSession: true })
    let shouldFail = true
    supabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'current_app_user_id') {
        return { data: FICTIONAL_APP_USER_ID, error: null }
      }
      if (name === 'list_my_workspaces') {
        return shouldFail
          ? {
              data: null,
              error: {
                message: 'sensitive SQL detail must never reach the screen',
              },
            }
          : { data: [fictionalWorkspace], error: null }
      }
      if (name === 'list_my_pending_workspace_invitations') {
        return { data: [], error: null }
      }
      return { data: null, error: null }
    })
    const resolveClient = readyResolver(supabase)
    const { result } = renderHook(() => useWorkspace(), {
      wrapper: providerWrapper(resolveClient),
    })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error?.code).toBe('temporary_failure')
    expect(result.current.error?.message).not.toContain('sensitive SQL')

    shouldFail = false
    await act(async () => result.current.refresh())
    expect(result.current.status).toBe('ready')
    expect(result.current.currentWorkspace).toEqual(fictionalWorkspace)
  })
})

describe('工作空间路由门禁', () => {
  it('没有活动工作空间但有待处理邀请时跳转到账户激活页', async () => {
    const supabase = createSupabaseClientMock({
      hasSession: true,
      workspaceRows: [],
      pendingInvitationRows: [
        {
          invitation_id: '88888888-8888-4888-8888-888888888888',
          workspace_id: '77777777-7777-4777-8777-777777777777',
          workspace_name: '待激活工作空间',
          role: 'external_collaborator',
          status: 'sent',
          expires_at: '2026-08-09T00:00:00+00:00',
        },
      ],
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter resolveClient={readyResolver(supabase)} />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: '激活工作空间账号',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('待激活工作空间')).toBeInTheDocument()
  })

  it('没有工作空间且没有邀请时显示受控空状态，不在浏览器自动创建租户', async () => {
    const supabase = createSupabaseClientMock({
      hasSession: true,
      workspaceRows: [],
      pendingInvitationRows: [],
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter resolveClient={readyResolver(supabase)} />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: '暂无可访问的工作空间',
      }),
    ).toBeInTheDocument()
    expect(
      supabase.rpc.mock.calls.some(
        ([name]) => name === 'bootstrap_default_workspace',
      ),
    ).toBe(false)
  })

  it('已有活动工作空间的用户访问激活页时返回工作台', async () => {
    const supabase = createSupabaseClientMock({ hasSession: true })

    render(
      <MemoryRouter initialEntries={['/activate-account']}>
        <AppRouter resolveClient={readyResolver(supabase)} />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: '工作台',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText('激活工作空间账号')).toBeNull()
  })
})
