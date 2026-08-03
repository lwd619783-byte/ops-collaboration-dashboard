import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { AppRouter } from '@/app/router/AppRouter'
import { createSupabaseClientMock } from '@/tests/helpers/supabaseAuthMock'

/**
 * /system-health isolation: with a valid persisted session the public health
 * route must render OUTSIDE the AuthProvider, so the provider never calls
 * auth.getSession(), current_app_user_id() or reads app_users / profiles —
 * only the public health-check RPC is allowed.
 *
 * We mock the module-level config/client resolvers (the ones SystemHealthPage
 * uses by default) so the health page can run its real check against a
 * controllable client, while AppRouter's AuthProviderLayout gets the same
 * injected client via its own resolveClient prop.
 */

const getSupabaseClientMock = vi.hoisted(() => vi.fn())
const getSupabaseConfigMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: (...args: unknown[]) => getSupabaseClientMock(...args),
}))

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: (...args: unknown[]) => getSupabaseConfigMock(...args),
  parseSupabaseConfig: () => ({ status: 'configured' as const }),
}))

function installHealthEnvironment(
  supabase: ReturnType<typeof createSupabaseClientMock>,
) {
  getSupabaseConfigMock.mockReturnValue({
    status: 'configured',
    config: {
      url: 'https://example.test',
      publishableKey: 'sb_publishable_test-key',
    },
  })
  getSupabaseClientMock.mockReturnValue({
    status: 'ready',
    client: supabase.client,
  })
}

function renderAt(path: string) {
  const supabase = createSupabaseClientMock({ hasSession: true })
  installHealthEnvironment(supabase)
  // The health page resolves its own client through the mocked module; the
  // AuthProviderLayout also receives the same client via resolveClient.
  // checkDatabaseHealth calls `.rpc('health_check').abortSignal(signal)`: the
  // real client returns a thenable builder with an abortSignal() method, so
  // the mock must return a Promise that ALSO exposes abortSignal().
  supabase.rpc.mockImplementation((name: string) => {
    const result =
      name === 'health_check'
        ? {
            data: [{ status: 'ok', checked_at: '2026-07-30T12:00:00+00:00' }],
            error: null,
          }
        : name === 'list_my_workspaces'
          ? {
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
          : name === 'list_my_pending_workspace_invitations'
            ? { data: [], error: null }
            : { data: null, error: null }
    const promise = Promise.resolve(result)
    return Object.assign(promise, {
      abortSignal: () => Promise.resolve(result),
    })
  })
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRouter
        resolveClient={() => ({ status: 'ready', client: supabase.client })}
      />
    </MemoryRouter>,
  )
  return supabase
}

describe('/system-health 与 AuthProvider 隔离', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    getSupabaseClientMock.mockReset()
    getSupabaseConfigMock.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
    getSupabaseClientMock.mockReset()
    getSupabaseConfigMock.mockReset()
  })

  it('已有会话时访问 /system-health 不启动身份 Provider', async () => {
    const supabase = renderAt('/system-health')

    expect(
      await screen.findByRole('heading', { level: 1, name: '系统健康' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('数据库连接正常')).toBeInTheDocument()

    // The AuthProvider must never have mounted for this route.
    expect(supabase.getSession).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalledWith('current_app_user_id')
    // Only the public health check RPC is allowed.
    expect(supabase.rpc).toHaveBeenCalledWith('health_check')
    // app_users / profiles must not be read.
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('已有会话时 /system-health 只执行健康检查 RPC', async () => {
    const supabase = renderAt('/system-health')
    await screen.findByText('数据库连接正常')
    const rpcNames = supabase.rpc.mock.calls.map((call) => call[0])
    expect(rpcNames).toEqual(['health_check'])
    expect(rpcNames).not.toContain('current_app_user_id')
  })

  it('未知公开 404 也不启动身份 Provider', async () => {
    const supabase = renderAt('/no-such-page')
    expect(
      await screen.findByRole('heading', { level: 2, name: '页面未找到' }),
    ).toBeInTheDocument()
    expect(supabase.getSession).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('登录页与业务页仍处于 AuthProvider 内（可完成登录）', async () => {
    const supabase = renderAt('/login')
    expect(
      await screen.findByRole('heading', { level: 2, name: '登录' }),
    ).toBeInTheDocument()
    expect(supabase.getSession).toHaveBeenCalled()
  })
})
