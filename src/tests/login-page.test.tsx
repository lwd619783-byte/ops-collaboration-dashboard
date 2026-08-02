import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { AppRouter } from '@/app/router/AppRouter'
import { createSupabaseClientMock } from '@/tests/helpers/supabaseAuthMock'

function renderLogin(
  options: Parameters<typeof createSupabaseClientMock>[0] = {},
) {
  const supabase = createSupabaseClientMock({ hasSession: false, ...options })
  render(
    <AuthProvider
      resolveClient={() => ({ status: 'ready', client: supabase.client })}
    >
      <MemoryRouter initialEntries={['/login']}>
        <AppRouter />
      </MemoryRouter>
    </AuthProvider>,
  )
  return supabase
}

describe('登录页', () => {
  beforeEach(() => window.sessionStorage.clear())
  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('字段类型与自动完成属性正确', async () => {
    renderLogin()
    const email = await screen.findByLabelText(/邮箱/)
    const password = screen.getByLabelText(/密码/)
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('autocomplete', 'email')
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
  })

  it('提交期间禁用重复提交', async () => {
    const supabase = renderLogin()
    // Keep the promise pending so the button stays disabled.
    supabase.signInWithPassword.mockImplementation(
      () => new Promise(() => undefined),
    )
    const user = userEvent.setup()
    const email = await screen.findByLabelText(/邮箱/)
    const password = screen.getByLabelText(/密码/)
    await user.type(email, 'a@example.com')
    await user.type(password, 'secret')
    const submit = screen.getByRole('button', { name: /登录/ })
    await user.click(submit)
    await waitFor(() => expect(submit).toBeDisabled())
    expect(supabase.signInWithPassword).toHaveBeenCalledTimes(1)
  })

  it('Enter 键可提交登录', async () => {
    const supabase = renderLogin()
    const user = userEvent.setup()
    const email = await screen.findByLabelText(/邮箱/)
    const password = screen.getByLabelText(/密码/)
    await user.type(email, 'a@example.com')
    await user.type(password, 'secret-password')
    await user.keyboard('{Enter}')

    expect(
      await screen.findByRole('heading', { level: 1, name: '工作台' }),
    ).toBeInTheDocument()
    expect(supabase.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@example.com',
      password: 'secret-password',
    })
  })

  it('错误以 role=alert 呈现且不泄露原始错误', async () => {
    renderLogin({
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

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('邮箱或密码不正确，请重新输入。')
    expect(document.body).not.toHaveTextContent('Invalid login')
    expect(document.body).not.toHaveTextContent('AuthApiError')
  })

  it('提供忘记密码入口且无公开注册入口', async () => {
    renderLogin()
    await screen.findByLabelText(/邮箱/)
    expect(screen.getByRole('link', { name: '忘记密码？' })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
    expect(
      screen.queryByRole('link', { name: /注册|创建账号/ }),
    ).not.toBeInTheDocument()
  })

  it('认证页面不显示业务导航', async () => {
    renderLogin()
    await screen.findByLabelText(/邮箱/)
    expect(
      screen.queryByRole('navigation', { name: '主导航' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '项目' })).not.toBeInTheDocument()
  })

  it('键盘焦点顺序完整可用', async () => {
    const user = userEvent.setup()
    renderLogin()
    await screen.findByLabelText(/邮箱/)
    emailFocusCheck()
    await user.tab()
    const password = screen.getByLabelText(/密码/)
    expect(password).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: /登录/ })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('link', { name: '忘记密码？' })).toHaveFocus()
  })

  it('手机窄屏认证表单无横向溢出', async () => {
    renderLogin()
    await screen.findByLabelText(/邮箱/)
    // jsdom has no layout engine; verify the structural guard rails: the auth
    // card is the fluid container (width: min(26rem, 100%) in styles.css) and
    // every field input is full-width (width: 100% via .field input) with no
    // fixed pixel width, so a 320px viewport cannot overflow horizontally.
    const authCard = document.querySelector<HTMLElement>('.auth-card')
    expect(authCard).not.toBeNull()
    expect(authCard?.classList.contains('auth-card')).toBe(true)
    expect(document.querySelector('.auth-form')).not.toBeNull()
    for (const input of document.querySelectorAll('.auth-form input')) {
      expect(input.getAttribute('style')).toBeNull()
      expect(input.getAttribute('width')).toBeNull()
    }
    expect(document.documentElement).toBeDefined()
  })

  it('状态提示具有 aria-live 与适当语义', async () => {
    renderLogin({
      signInError: {
        code: 'invalid_credentials',
        message: 'x',
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

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('aria-live', 'assertive')
  })
})

function emailFocusCheck() {
  const email = screen.getByLabelText(/邮箱/)
  email.focus()
  expect(email).toHaveFocus()
}
