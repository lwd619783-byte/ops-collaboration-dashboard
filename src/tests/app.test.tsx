import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '@/app/App'
describe('应用壳层与路由', () => {
  beforeEach(() => window.history.pushState({}, '', '/'))
  it('显示导航并标记当前工作台', () => {
    render(<App />)
    expect(
      screen.getByRole('navigation', { name: '主导航' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '工作台' })[0]).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
  it('可打开、关闭移动端导航并通过导航切换页面', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: '打开导航' }))
    expect(screen.getByLabelText('移动端导航')).toHaveClass('is-open')
    await user.click(screen.getAllByRole('link', { name: '项目' })[1])
    expect(
      screen.getByRole('heading', { level: 1, name: '项目' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('移动端导航')).not.toHaveClass('is-open')
  })
  it('Escape 关闭移动端导航', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: '打开导航' }))
    await user.keyboard('{Escape}')
    expect(screen.getByLabelText('移动端导航')).not.toHaveClass('is-open')
  })
  it('未知路由显示 404 并可返回工作台', async () => {
    window.history.pushState({}, '', '/missing-route')
    const user = userEvent.setup()
    render(<App />)
    expect(
      screen.getByRole('heading', { level: 2, name: '页面未找到' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: '返回工作台' }))
    expect(
      screen.getByRole('heading', { level: 1, name: '工作台' }),
    ).toBeInTheDocument()
  })
})
