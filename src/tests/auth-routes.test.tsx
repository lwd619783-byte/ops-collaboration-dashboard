import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { AppRouter } from '@/app/router/AppRouter'
import {
  createSupabaseClientMock,
  type MockClientOptions,
} from '@/tests/helpers/supabaseAuthMock'

function renderApp(options: MockClientOptions = {}) {
  const supabase = createSupabaseClientMock(options)
  const view = render(
    <AuthProvider
      resolveClient={() => ({ status: 'ready', client: supabase.client })}
    >
      <MemoryRouter initialEntries={['/projects']}>
        <AppRouter />
      </MemoryRouter>
    </AuthProvider>,
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

  it('未登录访问 /projects 跳转登录页', async () => {
    renderApp({ hasSession: false })
    expect(
      await screen.findByRole('heading', { level: 2, name: '登录' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { level: 1, name: '项目' }),
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

  it('恶意 returnTo 不会跳出本站（回退到工作台）', async () => {
    const supabase = createSupabaseClientMock({ hasSession: false })
    render(
      <AuthProvider
        resolveClient={() => ({ status: 'ready', client: supabase.client })}
      >
        <MemoryRouter
          initialEntries={[
            `/login?returnTo=${encodeURIComponent('https://evil.example')}`,
          ]}
        >
          <AppRouter />
        </MemoryRouter>
      </AuthProvider>,
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
    // Never resolve the session so the initializing/checking state persists and
    // the loading UI is observable without racing the identity resolution.
    supabase.getSession.mockImplementation(() => new Promise(() => undefined))
    render(
      <AuthProvider
        resolveClient={() => ({ status: 'ready', client: supabase.client })}
      >
        <MemoryRouter initialEntries={['/projects']}>
          <AppRouter />
        </MemoryRouter>
      </AuthProvider>,
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

  it('不可用用户被退出并显示安全提示', async () => {
    renderApp({ hasSession: true, currentAppUserId: null })
    expect(
      await screen.findByText('该账号尚未激活或暂不可使用，请联系系统管理员。'),
    ).toBeInTheDocument()
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
    expect(supabase.signOut).toHaveBeenCalled()
  })

  it('/system-health 保持公开且不读取身份业务数据', async () => {
    const supabase = createSupabaseClientMock({ hasSession: false })
    render(
      <AuthProvider
        resolveClient={() => ({ status: 'ready', client: supabase.client })}
      >
        <MemoryRouter initialEntries={['/system-health']}>
          <AppRouter />
        </MemoryRouter>
      </AuthProvider>,
    )
    expect(
      await screen.findByRole('heading', { level: 1, name: '系统健康' }),
    ).toBeInTheDocument()
    // The public health page must never call the identity resolver or read
    // app_users / profiles.
    expect(supabase.rpc).not.toHaveBeenCalledWith('current_app_user_id')
    expect(supabase.from).not.toHaveBeenCalled()
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
      <AuthProvider
        resolveClient={() => ({ status: 'ready', client: supabase.client })}
      >
        <MemoryRouter initialEntries={['/forgot-password']}>
          <AppRouter />
        </MemoryRouter>
      </AuthProvider>,
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
      <AuthProvider
        resolveClient={() => ({ status: 'ready', client: supabase.client })}
      >
        <MemoryRouter initialEntries={['/reset-password']}>
          <AppRouter />
        </MemoryRouter>
      </AuthProvider>,
    )
    // Emulate the recovery event that the provider receives from the URL flow.
    supabase.emitAuthEvent('PASSWORD_RECOVERY')

    const user = userEvent.setup()
    const password = await screen.findByLabelText(/^新密码/)
    const confirmation = screen.getByLabelText(/^确认新密码/)
    await user.type(password, 'new-password-123')
    await user.type(confirmation, 'new-password-123')
    await user.click(screen.getByRole('button', { name: '更新密码' }))

    expect(supabase.updateUser).toHaveBeenCalledWith({
      password: 'new-password-123',
    })
    // The provider clears the recovery session and navigates back to /login
    // where the success notice is displayed.
    expect(
      await screen.findByText('密码已更新，请使用新密码登录。'),
    ).toBeInTheDocument()
  })

  it('无效 recovery 状态不能提交（显示重新申请入口）', async () => {
    const supabase = createSupabaseClientMock({ hasSession: true })
    render(
      <AuthProvider
        resolveClient={() => ({ status: 'ready', client: supabase.client })}
      >
        <MemoryRouter initialEntries={['/reset-password']}>
          <AppRouter />
        </MemoryRouter>
      </AuthProvider>,
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
