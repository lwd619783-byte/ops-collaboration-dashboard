import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from '@/app/App'

describe('应用路由', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/')
  })

  it('在首页显示产品名称和工程状态', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: '运维协同看板' }),
    ).toBeInTheDocument()
    expect(screen.getByText('工程基线已就绪。')).toBeInTheDocument()
  })

  it('在未知路由显示 404 页面并允许返回首页', async () => {
    window.history.pushState({}, '', '/missing-route')
    const user = userEvent.setup()

    render(<App />)

    expect(
      screen.getByRole('heading', { name: '页面未找到' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: '返回首页' }))
    expect(
      screen.getByRole('heading', { name: '运维协同看板' }),
    ).toBeInTheDocument()
  })
})
