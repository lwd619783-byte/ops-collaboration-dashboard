import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { AppRouter } from '@/app/router/AppRouter'
import {
  createSupabaseClientMock,
  type MockClientOptions,
} from '@/tests/helpers/supabaseAuthMock'

function renderApp(
  options: MockClientOptions = {},
  initialEntry = '/projects',
) {
  const supabase = createSupabaseClientMock(options)
  const view = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppRouter
        resolveClient={() => ({ status: 'ready', client: supabase.client })}
      />
    </MemoryRouter>,
  )
  return { supabase, view }
}

describe('受保护路由', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.history.pushState({}, '', '/projects')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it.each([
    '/',
    '/projects',
    '/tasks',
    '/personal',
    '/members',
    '/settings',
    '/team-load',
    '/notifications',
  ])('未登录访问 %s 跳转登录页', async (path) => {
    renderApp({ hasSession: false }, path)
    expect(
      await screen.findByRole('heading', { level: 2, name: '登录' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: '主导航' }),
    ).not.toBeInTheDocument()
  })

  it('登录后安全返回原目标 /projects', async () => {
    renderApp({ hasSession: false })
    const user = userEvent.setup()
    const email = await screen.findByLabelText(/邮箱/)
    const password = screen.getByLabelText(/密码/)
    await user.type(email, 'a@example.com')
    await user.type(password, 'secret-password')
    await user.click(screen.getByRole('button', { name: /登录/ }))

    expect(
      await screen.findByRole('heading', { level: 1, name: '项目' }),
    ).toBeInTheDocument()
  })

  it('登录后安全返回 /tasks', async () => {
    renderApp({ hasSession: false }, '/tasks')
    const user = userEvent.setup()
    const email = await screen.findByLabelText(/邮箱/)
    const password = screen.getByLabelText(/密码/)
    await user.type(email, 'a@example.com')
    await user.type(password, 'secret-password')
    await user.click(screen.getByRole('button', { name: /登录/ }))

    expect(
      await screen.findByRole('heading', { level: 1, name: '我的任务' }),
    ).toBeInTheDocument()
  })

  it('/tasks 显示 AppLayout 且导航标记当前页面', async () => {
    renderApp({ hasSession: true }, '/tasks')
    expect(
      await screen.findByRole('navigation', { name: '主导航' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { level: 1, name: '我的任务' }),
    ).toBeInTheDocument()
    const tasksLink = screen.getAllByRole('link', { name: '我的任务' })[0]
    expect(tasksLink).toHaveAttribute('aria-current', 'page')
    expect(tasksLink).toHaveAttribute('href', '/tasks')
  })

  it('旧 /my-tasks 兼容重定向仍在认证守卫内（未登录跳登录，登录后回 /tasks）', async () => {
    renderApp({ hasSession: false }, '/my-tasks')
    expect(
      await screen.findByRole('heading', { level: 2, name: '登录' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '我的任务' })).toBeNull()
  })

  it('旧 /my-tasks 登录后重定向到 /tasks', async () => {
    const { supabase } = renderApp({ hasSession: false }, '/my-tasks')
    const user = userEvent.setup()
    const email = await screen.findByLabelText(/邮箱/)
    const password = screen.getByLabelText(/密码/)
    await user.type(email, 'a@example.com')
    await user.type(password, 'secret-password')
    await user.click(screen.getByRole('button', { name: /登录/ }))

    expect(
      await screen.findByRole('heading', { level: 1, name: '我的任务' }),
    ).toBeInTheDocument()
    expect(supabase.signOut).not.toHaveBeenCalled()
  })

  it('恶意 returnTo 不会跳出本站（回退到工作台）', async () => {
    const supabase = createSupabaseClientMock({ hasSession: false })
    render(
      <MemoryRouter
        initialEntries={[
          `/login?returnTo=${encodeURIComponent('https://evil.example')}`,
        ]}
      >
        <AppRouter
          resolveClient={() => ({ status: 'ready', client: supabase.client })}
        />
      </MemoryRouter>,
    )
    const user = userEvent.setup()
    const email = await screen.findByLabelText(/邮箱/)
    const password = screen.getByLabelText(/密码/)
    await user.type(email, 'a@example.com')
    await user.type(password, 'secret-password')
    await user.click(screen.getByRole('button', { name: /登录/ }))

    expect(
      await screen.findByRole('heading', { level: 1, name: '工作台' }),
    ).toBeInTheDocument()
  })

  it('认证检查期间不显示业务内容', async () => {
    const supabase = createSupabaseClientMock({ hasSession: true })
    supabase.getSession.mockImplementation(() => new Promise(() => undefined))
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppRouter
          resolveClient={() => ({ status: 'ready', client: supabase.client })}
        />
      </MemoryRouter>,
    )

    expect(await screen.findByText('正在验证登录状态')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { level: 1, name: '项目' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: '主导航' }),
    ).not.toBeInTheDocument()
  })

  it('正常用户可进入现有 AppLayout', async () => {
    renderApp({ hasSession: true })
    expect(
      await screen.findByRole('navigation', { name: '主导航' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { level: 1, name: '项目' }),
    ).toBeInTheDocument()
  })

  it.each([false, true])(
    'invalid invitation callback 显示固定错误且不泄漏或静默展示 owner（hasSession=%s）',
    async (hasSession) => {
      const supabase = createSupabaseClientMock({ hasSession })
      render(
        <MemoryRouter initialEntries={['/activate-account']}>
          <AppRouter
            resolveClient={() => ({
              status: 'ready',
              client: supabase.client,
              invitationCallback: { status: 'invalid' },
            })}
          />
        </MemoryRouter>,
      )

      expect(
        await screen.findByRole('heading', {
          level: 2,
          name: '邀请链接无效或已过期',
        }),
      ).toBeInTheDocument()
      expect(document.body).not.toHaveTextContent('otp_expired')
      expect(
        screen.queryByRole('navigation', { name: '主导航' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { level: 1, name: '工作台' }),
      ).not.toBeInTheDocument()
      expect(supabase.signOut).not.toHaveBeenCalled()
    },
  )

  it('valid invitation callback 等待 PKCE reload 时不展示 owner 内容', async () => {
    const supabase = createSupabaseClientMock({ hasSession: true })
    const reloadWithPkce = vi.fn()
    render(
      <MemoryRouter initialEntries={['/activate-account']}>
        <AppRouter
          resolveClient={() => ({
            status: 'ready',
            client: supabase.client,
            invitationCallback: { status: 'pending', reloadWithPkce },
          })}
        />
      </MemoryRouter>,
    )

    await waitFor(() => expect(reloadWithPkce).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('正在验证登录状态')).toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: '主导航' }),
    ).not.toBeInTheDocument()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('不可用用户被集中退出并显示安全提示（不在渲染中触发 signOut）', async () => {
    const { supabase } = renderApp({ hasSession: true, currentAppUserId: null })
    expect(
      await screen.findByText('该账号尚未激活或暂不可使用，请联系系统管理员。'),
    ).toBeInTheDocument()
    await waitFor(() => expect(supabase.signOut).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { level: 1, name: '项目' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('登录失败不显示原始 Supabase 信息', async () => {
    renderApp({
      hasSession: false,
      signInError: {
        code: 'invalid_credentials',
        message: 'Invalid login credentials',
        name: 'AuthApiError',
        status: 400,
      },
    })
    const user = userEvent.setup()
    const email = await screen.findByLabelText(/邮箱/)
    const password = screen.getByLabelText(/密码/)
    await user.type(email, 'a@example.com')
    await user.type(password, 'wrong')
    await user.click(screen.getByRole('button', { name: /登录/ }))

    expect(
      await screen.findByText('邮箱或密码不正确，请重新输入。'),
    ).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Invalid login')
  })

  it('退出后受保护页面不可访问', async () => {
    const { supabase } = renderApp({ hasSession: true })
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: '项目' })
    await user.click(screen.getByRole('button', { name: '退出登录' }))

    expect(
      await screen.findByRole('heading', { level: 2, name: '登录' }),
    ).toBeInTheDocument()
    expect(supabase.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('RPC 网络失败进入可恢复错误态且不误报账号停用、不退出', async () => {
    const { supabase } = renderApp({
      hasSession: true,
      rpcNetworkFailure: true,
    })
    expect(await screen.findByText('暂时无法完成验证')).toBeInTheDocument()
    expect(
      screen.queryByText('该账号尚未激活或暂不可使用，请联系系统管理员。'),
    ).not.toBeInTheDocument()
    expect(supabase.signOut).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('heading', { level: 1, name: '项目' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('app_users 读取失败进入可恢复错误态且不误报账号停用', async () => {
    const { supabase } = renderApp({
      hasSession: true,
      appUserReadError: {
        code: 'db_error',
        message: 'secret sql',
        name: 'PostgrestError',
      },
    })
    expect(await screen.findByText('暂时无法完成验证')).toBeInTheDocument()
    expect(supabase.signOut).not.toHaveBeenCalled()
    expect(document.body).not.toHaveTextContent('secret sql')
  })

  it('profile 读取失败进入可恢复错误态（不进入 authorized 无限加载）', async () => {
    const { supabase } = renderApp({
      hasSession: true,
      profileReadError: {
        code: 'db_error',
        message: 'secret sql',
        name: 'PostgrestError',
      },
    })
    expect(await screen.findByText('暂时无法完成验证')).toBeInTheDocument()
    expect(supabase.signOut).not.toHaveBeenCalled()
    expect(document.body).not.toHaveTextContent('secret sql')
  })

  it('重试后可以恢复授权', async () => {
    const supabase = createSupabaseClientMock({
      hasSession: true,
      rpcNetworkFailure: true,
    })
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppRouter
          resolveClient={() => ({ status: 'ready', client: supabase.client })}
        />
      </MemoryRouter>,
    )
    expect(await screen.findByText('暂时无法完成验证')).toBeInTheDocument()

    // Remove the failure and retry.
    supabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'current_app_user_id') {
        return { data: '11111111-1111-1111-1111-111111111111', error: null }
      }
      if (name === 'list_my_workspaces') {
        return {
          data: [
            {
              workspace_id: '99999999-9999-4999-8999-999999999999',
              workspace_name: 'Fictional Workspace',
              role: 'owner',
              status: 'active',
              joined_at: '2026-01-01T00:00:00+00:00',
            },
          ],
          error: null,
        }
      }
      if (name === 'list_my_pending_workspace_invitations') {
        return { data: [], error: null }
      }
      return { data: null, error: null }
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: '项目' }),
    ).toBeInTheDocument()
  })

  it('原始错误内容不进入 DOM', async () => {
    renderApp({
      hasSession: true,
      rpcNetworkFailure: true,
    })
    await screen.findByText('暂时无法完成验证')
    expect(document.body).not.toHaveTextContent('Failed to fetch')
    expect(document.body).not.toHaveTextContent('current_app_user_id')
  })
})

describe('认证页面', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('忘记密码始终显示相同成功文案且不暴露邮箱是否存在', async () => {
    const supabase = createSupabaseClientMock({
      hasSession: false,
      resetError: {
        code: 'invalid_credentials',
        message: 'Invalid login credentials',
        name: 'AuthApiError',
        status: 400,
      },
    })
    render(
      <MemoryRouter initialEntries={['/forgot-password']}>
        <AppRouter
          resolveClient={() => ({ status: 'ready', client: supabase.client })}
        />
      </MemoryRouter>,
    )
    const user = userEvent.setup()
    const email = await screen.findByLabelText(/邮箱/)
    await user.type(email, 'does-not-exist@example.com')
    await user.click(screen.getByRole('button', { name: '发送重置链接' }))

    expect(
      await screen.findByText(
        '若该邮箱已关联可用账号，系统将发送密码重置邮件。',
      ),
    ).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Invalid login')
  })

  it('有效 recovery 状态可以更新密码', async () => {
    const supabase = createSupabaseClientMock({ hasSession: true })
    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <AppRouter
          resolveClient={() => ({ status: 'ready', client: supabase.client })}
        />
      </MemoryRouter>,
    )
    act(() => supabase.emitAuthEvent('PASSWORD_RECOVERY'))

    const user = userEvent.setup()
    const password = await screen.findByLabelText(/^新密码/)
    const confirmation = screen.getByLabelText(/^确认新密码/)
    await user.type(password, 'new-password-123')
    await user.type(confirmation, 'new-password-123')
    await user.click(screen.getByRole('button', { name: '更新密码' }))

    expect(supabase.updateUser).toHaveBeenCalledWith({
      password: 'new-password-123',
    })
    expect(
      await screen.findByText('密码已更新，请使用新密码登录。'),
    ).toBeInTheDocument()
  })

  it('无效 recovery 状态不能提交（显示重新申请入口）', async () => {
    const supabase = createSupabaseClientMock({ hasSession: true })
    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <AppRouter
          resolveClient={() => ({ status: 'ready', client: supabase.client })}
        />
      </MemoryRouter>,
    )
    expect(
      await screen.findByText('重置密码链接无效或已过期，请重新申请。'),
    ).toBeInTheDocument()
    expect(supabase.updateUser).not.toHaveBeenCalled()
    expect(
      screen.getByRole('link', { name: '重新申请重置链接' }),
    ).toBeInTheDocument()
  })
})

describe('公开 404 与健康页', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('未知公开 404 不读取业务数据', async () => {
    const supabase = createSupabaseClientMock({ hasSession: true })
    render(
      <MemoryRouter initialEntries={['/unknown-route']}>
        <AppRouter
          resolveClient={() => ({ status: 'ready', client: supabase.client })}
        />
      </MemoryRouter>,
    )
    expect(
      await screen.findByRole('heading', { level: 2, name: '页面未找到' }),
    ).toBeInTheDocument()
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
    expect(supabase.getSession).not.toHaveBeenCalled()
  })
})

describe('recovery-only 会话与受保护路由', () => {
  beforeEach(() => window.sessionStorage.clear())
  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('recovery-only 用户访问 /projects 跳转 /reset-password，不显示加载态或 AppLayout', async () => {
    const supabase = createSupabaseClientMock({
      hasSession: true,
      currentAppUserId: null,
    })
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppRouter
          resolveClient={() => ({ status: 'ready', client: supabase.client })}
        />
      </MemoryRouter>,
    )
    // A valid recovery session exists but the internal identity cannot be
    // resolved — this is the recovery-only state.
    act(() => supabase.emitAuthEvent('PASSWORD_RECOVERY'))

    // The user is redirected to /reset-password, which renders the password
    // form (recovery marker kept), NOT a permanent "signing out" loader and
    // NOT the business AppLayout.
    expect(
      await screen.findByRole('heading', { level: 2, name: '重置密码' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('正在安全退出')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: '主导航' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { level: 1, name: '项目' }),
    ).not.toBeInTheDocument()
    // Recovery marker is preserved so the password form stays usable.
    expect(window.sessionStorage.getItem('ops-auth-recovery-session')).toBe('1')
    // No account-unavailable sign-out happens for a recovery-only session.
    expect(supabase.signOut).not.toHaveBeenCalled()
  })

  it('recovery-only 用户不会形成 /reset-password 与业务路由的跳转循环', async () => {
    const supabase = createSupabaseClientMock({
      hasSession: true,
      currentAppUserId: null,
    })
    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <AppRouter
          resolveClient={() => ({ status: 'ready', client: supabase.client })}
        />
      </MemoryRouter>,
    )
    act(() => supabase.emitAuthEvent('PASSWORD_RECOVERY'))

    expect(
      await screen.findByRole('heading', { level: 2, name: '重置密码' }),
    ).toBeInTheDocument()
    // The page stays on /reset-password (form visible), no loader, no loop.
    expect(screen.queryByText('正在验证登录状态')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: '主导航' }),
    ).not.toBeInTheDocument()
  })

  it('普通非 recovery 的身份不可用账号仍执行原有退出流程', async () => {
    const supabase = createSupabaseClientMock({
      hasSession: true,
      currentAppUserId: null,
    })
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppRouter
          resolveClient={() => ({ status: 'ready', client: supabase.client })}
        />
      </MemoryRouter>,
    )
    // NO PASSWORD_RECOVERY event: this is a plain unusable account.
    expect(
      await screen.findByText('该账号尚未激活或暂不可使用，请联系系统管理员。'),
    ).toBeInTheDocument()
    await waitFor(() => expect(supabase.signOut).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { level: 1, name: '项目' }),
      ).not.toBeInTheDocument(),
    )
  })
})
