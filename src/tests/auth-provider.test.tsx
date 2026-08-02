import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { useAuth, type AuthContextValue } from '@/features/auth'
import { createSupabaseClientMock } from '@/tests/helpers/supabaseAuthMock'
import { RECOVERY_SESSION_STORAGE_KEY } from '@/features/auth/authService'

function renderAuth(options: Parameters<typeof createSupabaseClientMock>[0]) {
  const supabase = createSupabaseClientMock(options)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider
      resolveClient={() => ({ status: 'ready', client: supabase.client })}
    >
      {children}
    </AuthProvider>
  )
  const rendered = renderHook(() => useAuth(), { wrapper })
  return { supabase, rendered }
}

describe('AuthProvider 状态机', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('初始状态为 initializing 并最终进入未登录', async () => {
    const { supabase, rendered } = renderAuth({ hasSession: false })
    expect(rendered.result.current.status).toBe('initializing')
    expect(supabase.getSession).toHaveBeenCalled()
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('unauthenticated'),
    )
    expect(rendered.result.current.appUser).toBeNull()
    expect(rendered.result.current.profile).toBeNull()
  })

  it('会话恢复后解析身份并进入已授权', async () => {
    const { supabase, rendered } = renderAuth({ hasSession: true })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('authenticated_authorized'),
    )
    expect(supabase.rpc).toHaveBeenCalledWith('current_app_user_id')
    expect(rendered.result.current.appUser?.id).toBe(
      '11111111-1111-1111-1111-111111111111',
    )
    expect(rendered.result.current.profile?.user_id).toBe(
      '11111111-1111-1111-1111-111111111111',
    )
  })

  it('登录成功但内部身份不存在时不可用并安全退出', async () => {
    const { supabase, rendered } = renderAuth({ hasSession: false })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('unauthenticated'),
    )
    supabase.rpc.mockResolvedValue({ data: null, error: null })
    let result: Awaited<ReturnType<AuthContextValue['signIn']>> | undefined
    await act(async () => {
      result = await rendered.result.current.signIn('a@example.com', 'secret')
    })
    expect(result && 'error' in result ? result.error.code : '').toBe(
      'identity_unavailable',
    )
    await waitFor(() =>
      expect(rendered.result.current.notice).toBe(
        '该账号尚未激活或暂不可使用，请联系系统管理员。',
      ),
    )
    expect(supabase.signOut).toHaveBeenCalled()
  })

  it('suspended / revoked 等身份不可用统一拒绝并退出', async () => {
    const { supabase, rendered } = renderAuth({
      hasSession: true,
      currentAppUserId: null,
    })
    await waitFor(() => expect(supabase.signOut).toHaveBeenCalled())
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('unauthenticated'),
    )
    expect(rendered.result.current.notice).toBe(
      '该账号尚未激活或暂不可使用，请联系系统管理员。',
    )
  })

  it('登录成功后进入已授权', async () => {
    const { supabase, rendered } = renderAuth({ hasSession: false })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('unauthenticated'),
    )
    let result: Awaited<ReturnType<AuthContextValue['signIn']>> | undefined
    await act(async () => {
      result = await rendered.result.current.signIn('a@example.com', 'secret')
    })
    expect(supabase.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@example.com',
      password: 'secret',
    })
    expect(result).toEqual({ ok: true })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('authenticated_authorized'),
    )
  })

  it('SIGNED_OUT 事件清空用户状态并转为未登录', async () => {
    const { supabase, rendered } = renderAuth({ hasSession: true })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('authenticated_authorized'),
    )
    act(() => supabase.emitAuthEvent('SIGNED_OUT'))
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('unauthenticated'),
    )
    expect(rendered.result.current.appUser).toBeNull()
    expect(rendered.result.current.profile).toBeNull()
  })

  it('TOKEN_REFRESHED 后重新校验身份', async () => {
    const { supabase, rendered } = renderAuth({ hasSession: true })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('authenticated_authorized'),
    )
    const rpcCallsBefore = supabase.rpc.mock.calls.length
    act(() => supabase.emitAuthEvent('TOKEN_REFRESHED'))
    await waitFor(() =>
      expect(supabase.rpc.mock.calls.length).toBeGreaterThan(rpcCallsBefore),
    )
    expect(rendered.result.current.status).toBe('authenticated_authorized')
  })

  it('PASSWORD_RECOVERY 事件标记 recovery 会话', async () => {
    const { supabase, rendered } = renderAuth({ hasSession: true })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('authenticated_authorized'),
    )
    act(() => supabase.emitAuthEvent('PASSWORD_RECOVERY'))
    await waitFor(() =>
      expect(rendered.result.current.isRecoverySession).toBe(true),
    )
    expect(window.sessionStorage.getItem(RECOVERY_SESSION_STORAGE_KEY)).toBe(
      '1',
    )
  })

  it('退出登录后清空用户状态', async () => {
    const { supabase, rendered } = renderAuth({ hasSession: true })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('authenticated_authorized'),
    )
    await act(async () => rendered.result.current.signOut())
    expect(supabase.signOut).toHaveBeenCalled()
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('unauthenticated'),
    )
    expect(rendered.result.current.appUser).toBeNull()
  })

  it('token 刷新失败（SIGNED_OUT）后转为未登录', async () => {
    const { supabase, rendered } = renderAuth({ hasSession: true })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('authenticated_authorized'),
    )
    act(() => supabase.emitAuthEvent('SIGNED_OUT'))
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('unauthenticated'),
    )
  })

  it('profile 更新成功后刷新上下文中的 profile', async () => {
    const { supabase, rendered } = renderAuth({ hasSession: true })
    await waitFor(() =>
      expect(rendered.result.current.profile?.user_id).toBe(
        '11111111-1111-1111-1111-111111111111',
      ),
    )
    let result:
      Awaited<ReturnType<AuthContextValue['updateProfile']>> | undefined
    await act(async () => {
      result = await rendered.result.current.updateProfile({
        display_name: 'New Name',
        organization_name: 'New Org',
        title: 'New Title',
      })
    })
    expect(result && 'ok' in result ? result.ok : false).toBe(true)
    expect(
      supabase.from.mock.calls.some((call) => call[0] === 'profiles'),
    ).toBe(true)
  })

  it('updateProfile 只提交白名单字段（不含 user_id）', async () => {
    const { supabase, rendered } = renderAuth({ hasSession: true })
    await waitFor(() =>
      expect(rendered.result.current.profile?.user_id).toBe(
        '11111111-1111-1111-1111-111111111111',
      ),
    )
    await act(async () =>
      rendered.result.current.updateProfile({
        display_name: '  Name With Space  ',
        organization_name: '',
        title: null,
      }),
    )
    const profileQuery = supabase.from.mock.results.find(
      (result) =>
        result.type === 'return' &&
        typeof result.value?.update?.mock?.calls?.length === 'number' &&
        result.value.update.mock.calls.length > 0,
    )
    expect(profileQuery).toBeDefined()
    expect(profileQuery?.value.update).toHaveBeenCalledWith({
      display_name: 'Name With Space',
      organization_name: null,
      title: null,
    })
  })

  it('请求密码重置使用受控的 /reset-password 重定向地址', async () => {
    const { supabase, rendered } = renderAuth({ hasSession: false })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('unauthenticated'),
    )
    let result:
      Awaited<ReturnType<AuthContextValue['requestPasswordReset']>> | undefined
    await act(async () => {
      result =
        await rendered.result.current.requestPasswordReset('a@example.com')
    })
    expect(result).toEqual({ ok: true })
    expect(supabase.resetPasswordForEmail).toHaveBeenCalledWith(
      'a@example.com',
      {
        redirectTo: 'http://localhost:3000/reset-password',
      },
    )
  })

  it('recovery 状态下可以更新密码并清理 recovery 标记', async () => {
    const { supabase, rendered } = renderAuth({ hasSession: true })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('authenticated_authorized'),
    )
    act(() => supabase.emitAuthEvent('PASSWORD_RECOVERY'))
    await waitFor(() =>
      expect(rendered.result.current.isRecoverySession).toBe(true),
    )
    let result:
      Awaited<ReturnType<AuthContextValue['updatePassword']>> | undefined
    await act(async () => {
      result = await rendered.result.current.updatePassword('new-password-123')
    })
    expect(result).toEqual({ ok: true })
    expect(supabase.updateUser).toHaveBeenCalledWith({
      password: 'new-password-123',
    })
    expect(
      window.sessionStorage.getItem(RECOVERY_SESSION_STORAGE_KEY),
    ).toBeNull()
    await waitFor(() =>
      expect(rendered.result.current.isRecoverySession).toBe(false),
    )
  })

  it('Supabase 未配置时 signIn 返回安全错误', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider
        resolveClient={() => ({
          status: 'unavailable',
          reason: 'unconfigured',
        })}
      >
        {children}
      </AuthProvider>
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('unauthenticated'))
    let outcome: Awaited<ReturnType<AuthContextValue['signIn']>> | undefined
    await act(async () => {
      outcome = await result.current.signIn('a@example.com', 'secret')
    })
    expect(outcome && 'error' in outcome ? outcome.error.code : '').toBe(
      'supabase_unconfigured',
    )
  })
})
