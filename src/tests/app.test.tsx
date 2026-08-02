import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/app/App'
import { createSupabaseClientMock } from '@/tests/helpers/supabaseAuthMock'

const getSupabaseClientMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: (...args: unknown[]) => getSupabaseClientMock(...args),
}))

function installAuthorizedClient() {
  const supabase = createSupabaseClientMock({ hasSession: true })
  getSupabaseClientMock.mockReturnValue({
    status: 'ready',
    client: supabase.client,
  })
  return supabase
}

function navigate(path: string) {
  act(() => {
    window.history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}

function mobileDrawer() {
  return document.querySelector<HTMLElement>('.mobile-drawer')
}

describe('应用壳层与路由', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/')
    installAuthorizedClient()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    getSupabaseClientMock.mockReset()
  })

  it('显示导航并只标记当前页面', async () => {
    render(<App />)
    expect(
      await screen.findByRole('navigation', { name: '主导航' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '工作台' })[0]).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      screen.getAllByRole('link', { name: '项目' })[0],
    ).not.toHaveAttribute('aria-current')
  })

  it('打开抽屉后聚焦关闭按钮、隔离背景并锁定滚动', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: '打开导航' })
    await user.click(screen.getByRole('button', { name: '打开导航' }))

    expect(screen.getByRole('button', { name: '关闭导航' })).toHaveFocus()
    expect(mobileDrawer()).toHaveClass('is-open')
    expect(mobileDrawer()).not.toHaveAttribute('inert')
    expect(document.querySelector('.app-content')).toHaveAttribute('inert')
    expect(document.querySelector('.mobile-topbar')).toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('hidden')
  })

  it.each([
    ['关闭按钮', '关闭导航'],
    ['遮罩', '关闭导航遮罩'],
  ])('%s 关闭抽屉并把焦点还给触发按钮', async (_, accessibleName) => {
    const user = userEvent.setup()
    render(<App />)
    const opener = await screen.findByRole('button', { name: '打开导航' })
    await user.click(opener)
    await user.click(screen.getByRole('button', { name: accessibleName }))

    expect(mobileDrawer()).not.toHaveClass('is-open')
    expect(mobileDrawer()).toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('')
    expect(opener).toHaveFocus()
  })

  it('Escape 关闭抽屉并恢复触发按钮焦点', async () => {
    const user = userEvent.setup()
    render(<App />)
    const opener = await screen.findByRole('button', { name: '打开导航' })
    await user.click(opener)
    await user.keyboard('{Escape}')
    expect(mobileDrawer()).not.toHaveClass('is-open')
    expect(opener).toHaveFocus()
  })

  it('导航后关闭抽屉并把焦点移到新页面主要内容', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: '打开导航' })
    await user.click(screen.getByRole('button', { name: '打开导航' }))
    await user.click(screen.getAllByRole('link', { name: '项目' })[1])

    expect(
      await screen.findByRole('heading', { level: 1, name: '项目' }),
    ).toBeInTheDocument()
    expect(mobileDrawer()).not.toHaveClass('is-open')
    expect(document.querySelector('main')).toHaveFocus()
  })

  it('浏览器历史导航关闭抽屉，返回原路由也不会重新打开', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: '打开导航' })
    await user.click(screen.getByRole('button', { name: '打开导航' }))

    navigate('/projects')
    await waitFor(() => expect(mobileDrawer()).not.toHaveClass('is-open'))
    navigate('/')
    expect(mobileDrawer()).not.toHaveClass('is-open')
    expect(screen.getByRole('button', { name: '打开导航' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('跳过链接把键盘焦点移到主要内容', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('link', { name: '跳到主要内容' })
    await user.click(screen.getByRole('link', { name: '跳到主要内容' }))
    expect(document.querySelector('main')).toHaveFocus()
  })

  it('未知路由显示 404 并可返回工作台', async () => {
    window.history.pushState({}, '', '/missing-route')
    const user = userEvent.setup()
    render(<App />)
    expect(
      await screen.findByRole('heading', { level: 2, name: '页面未找到' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: '返回工作台' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: '工作台' }),
    ).toBeInTheDocument()
  })

  it('系统健康路由保持公开并在无配置时安全降级', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    window.history.pushState({}, '', '/system-health')
    render(<App />)
    expect(
      screen.getByRole('heading', { level: 1, name: '系统健康' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Supabase 尚未配置')).toBeInTheDocument()
  })
})
