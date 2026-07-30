import { render, screen, waitFor } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClientResolution } from '@/lib/supabase/client'
import type { SupabaseConfigResult } from '@/lib/supabase/config'
import { SystemHealthPage } from '@/pages/SystemHealthPage'
import type { Database } from '@/types/database.generated'

const configured: SupabaseConfigResult = {
  status: 'configured',
  config: {
    url: 'https://example.test',
    publishableKey: 'sb_publishable_test-key',
  },
}

const readyClient = {
  rpc: vi.fn(),
} as unknown as SupabaseClient<Database>

function resolveReadyClient(): SupabaseClientResolution {
  return { status: 'ready', client: readyClient }
}

describe('系统健康页面', () => {
  it('未配置时显示明确说明且不显示环境变量值', () => {
    render(
      <SystemHealthPage
        resolveConfig={() => ({
          status: 'unconfigured',
          missing: ['url', 'publishableKey'],
        })}
      />,
    )

    expect(screen.getByText('Supabase 尚未配置')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('sb_publishable_')
  })

  it('检查期间复用加载状态组件', () => {
    const resolveClient = vi.fn(resolveReadyClient)
    render(
      <SystemHealthPage
        resolveConfig={() => configured}
        resolveClient={resolveClient}
        runHealthCheck={() => new Promise(() => undefined)}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('正在检查数据库连接')
    expect(resolveClient).toHaveBeenCalledWith()
  })

  it('配置无效时不解析客户端', () => {
    const resolveClient = vi.fn(resolveReadyClient)
    render(
      <SystemHealthPage
        resolveConfig={() => ({
          status: 'invalid',
          message: '检测到不安全或无效的 Supabase 前端配置。',
        })}
        resolveClient={resolveClient}
      />,
    )

    expect(screen.getByText('Supabase 配置无效')).toBeInTheDocument()
    expect(resolveClient).not.toHaveBeenCalled()
  })

  it('成功时显示文字状态和数据库检查时间', async () => {
    render(
      <SystemHealthPage
        resolveConfig={() => configured}
        resolveClient={resolveReadyClient}
        runHealthCheck={async () => ({
          status: 'ok',
          checkedAt: '2026-07-30T12:00:00+00:00',
        })}
      />,
    )

    expect(await screen.findByText('数据库连接正常')).toBeInTheDocument()
    expect(screen.getByText('正常')).toBeInTheDocument()
    expect(screen.getByText('2026年7月30日 20:00')).toHaveAttribute(
      'dateTime',
      '2026-07-30T12:00:00+00:00',
    )
  })

  it('失败时只显示安全说明并可通过键盘重试成功', async () => {
    const user = userEvent.setup()
    const runHealthCheck = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'error',
        message: '暂时无法连接数据库，请稍后重试或联系系统维护人员。',
      })
      .mockResolvedValueOnce({
        status: 'ok',
        checkedAt: '2026-07-30T12:00:00+00:00',
      })

    render(
      <SystemHealthPage
        resolveConfig={() => configured}
        resolveClient={resolveReadyClient}
        runHealthCheck={runHealthCheck}
      />,
    )

    const retry = await screen.findByRole('button', { name: '重新检查' })
    retry.focus()
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(screen.getByText('数据库连接正常')).toBeInTheDocument(),
    )
    expect(runHealthCheck).toHaveBeenCalledTimes(2)
  })

  it('组件卸载后忽略延迟完成的检查', async () => {
    let complete:
      ((value: { status: 'ok'; checkedAt: string }) => void) | undefined
    const pending = new Promise<{ status: 'ok'; checkedAt: string }>(
      (resolve) => {
        complete = resolve
      },
    )
    const view = render(
      <SystemHealthPage
        resolveConfig={() => configured}
        resolveClient={resolveReadyClient}
        runHealthCheck={() => pending}
      />,
    )

    view.unmount()
    complete?.({
      status: 'ok',
      checkedAt: '2026-07-30T12:00:00+00:00',
    })
    await pending
    expect(screen.queryByText('数据库连接正常')).not.toBeInTheDocument()
  })
})
