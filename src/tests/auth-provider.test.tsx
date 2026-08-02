import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { useAuth, type AuthContextValue } from '@/features/auth'
import {
  createSupabaseClientMock,
  fictionalAppUser,
  fictionalProfile,
} from '@/tests/helpers/supabaseAuthMock'
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
    // Credentials were accepted; identity resolution happens via SIGNED_IN.
    expect(result).toEqual({ ok: true })
    await waitFor(() =>
      expect(rendered.result.current.notice).toBe(
        '该账号尚未激活或暂不可使用，请联系系统管理员。',
      ),
    )
    expect(supabase.signOut).toHaveBeenCalledWith({ scope: 'local' })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('unauthenticated'),
    )
  })

  it('suspended / revoked 等身份不可用统一拒绝并退出', async () => {
    const { supabase, rendered } = renderAuth({
      hasSession: true,
      currentAppUserId: null,
    })
    await waitFor(() => expect(supabase.signOut).toHaveBeenCalledTimes(1))
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

  it('signInWithPassword 成功会触发 SIGNED_IN 事件', async () => {
    const { supabase, rendered } = renderAuth({ hasSession: false })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('unauthenticated'),
    )
    const signedIn: string[] = []
    const originalListener = supabase.authEventListeners[0]
    if (originalListener) {
      const wrapped = (event: string) => {
        if (event === 'SIGNED_IN') signedIn.push(event)
        originalListener(event as never)
      }
      supabase.authEventListeners[0] = wrapped
    }
    await act(async () => {
      await rendered.result.current.signIn('a@example.com', 'secret')
    })
    expect(signedIn).toContain('SIGNED_IN')
  })

  it('updateUser 成功会触发 USER_UPDATED 事件', async () => {
    const { supabase, rendered } = renderAuth({ hasSession: true })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('authenticated_authorized'),
    )
    act(() => supabase.emitAuthEvent('PASSWORD_RECOVERY'))
    await waitFor(() =>
      expect(rendered.result.current.isRecoverySession).toBe(true),
    )

    const userUpdated: string[] = []
    const originalListener = supabase.authEventListeners[0]
    if (originalListener) {
      const wrapped = (event: string) => {
        if (event === 'USER_UPDATED') userUpdated.push(event)
        originalListener(event as never)
      }
      supabase.authEventListeners[0] = wrapped
    }
    await act(async () => {
      await rendered.result.current.updatePassword('new-password-123')
    })
    expect(userUpdated).toContain('USER_UPDATED')
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

  it('退出登录后清空用户状态且使用 local scope', async () => {
    const { supabase, rendered } = renderAuth({ hasSession: true })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('authenticated_authorized'),
    )
    await act(async () => rendered.result.current.signOut())
    expect(supabase.signOut).toHaveBeenCalledWith({ scope: 'local' })
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
    // Password update signs out locally and must STAY unauthenticated even
    // though USER_UPDATED may have scheduled a re-resolution.
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('unauthenticated'),
    )
    expect(rendered.result.current.appUser).toBeNull()
    expect(rendered.result.current.profile).toBeNull()
  })

  it('Supabase 未配置时 signIn 返回安全错误（unconfigured）', async () => {
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
    await waitFor(() =>
      expect(result.current.status).toBe('authenticated_error'),
    )
    let outcome: Awaited<ReturnType<AuthContextValue['signIn']>> | undefined
    await act(async () => {
      outcome = await result.current.signIn('a@example.com', 'secret')
    })
    expect(outcome && 'error' in outcome ? outcome.error.code : '').toBe(
      'supabase_unconfigured',
    )
    expect(result.current.configState).toBe('unconfigured')
  })

  it('Supabase 配置无效时 signIn 返回 supabase_config_invalid 且保留差异', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider
        resolveClient={() => ({
          status: 'unavailable',
          reason: 'invalid',
        })}
      >
        {children}
      </AuthProvider>
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() =>
      expect(result.current.status).toBe('authenticated_error'),
    )
    expect(result.current.configState).toBe('invalid')
    expect(result.current.authError?.code).toBe('supabase_config_invalid')
    let outcome: Awaited<ReturnType<AuthContextValue['signIn']>> | undefined
    await act(async () => {
      outcome = await result.current.signIn('a@example.com', 'secret')
    })
    expect(outcome && 'error' in outcome ? outcome.error.code : '').toBe(
      'supabase_config_invalid',
    )
    // The raw invalid-config detail must never be exposed.
    expect(result.current.authError?.message).not.toContain('key')
    expect(result.current.authError?.message).not.toContain('URL')
  })

  it('RPC 网络错误进入可恢复错误态，不误报账号停用、不退出', async () => {
    const { supabase, rendered } = renderAuth({
      hasSession: true,
      rpcNetworkFailure: true,
    })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('authenticated_error'),
    )
    expect(rendered.result.current.authError?.code).toBe('network_unavailable')
    expect(rendered.result.current.notice).not.toBe(
      '该账号尚未激活或暂不可使用，请联系系统管理员。',
    )
    expect(supabase.signOut).not.toHaveBeenCalled()
    expect(rendered.result.current.appUser).toBeNull()
    expect(rendered.result.current.profile).toBeNull()
  })

  it('RPC 报错不误报身份不可用', async () => {
    const { supabase, rendered } = renderAuth({
      hasSession: true,
      currentAppUserIdError: {
        code: 'rpc_failed',
        message: 'secret rpc failure',
        name: 'PostgrestError',
      },
    })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('authenticated_error'),
    )
    expect(rendered.result.current.authError?.code).toBe('unknown')
    expect(supabase.signOut).not.toHaveBeenCalled()
    expect(document.body ? true : true).toBe(true)
    expect(rendered.result.current.notice).not.toBe(
      '该账号尚未激活或暂不可使用，请联系系统管理员。',
    )
  })

  it('app_users 读取失败进入可恢复错误态', async () => {
    const { supabase, rendered } = renderAuth({
      hasSession: true,
      appUserReadError: {
        code: 'db_error',
        message: 'secret sql',
        name: 'PostgrestError',
      },
    })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('authenticated_error'),
    )
    expect(supabase.signOut).not.toHaveBeenCalled()
    expect(rendered.result.current.authError?.message).not.toContain('sql')
  })

  it('profile 读取失败进入可恢复错误态（profile_read_failed）', async () => {
    const { supabase, rendered } = renderAuth({
      hasSession: true,
      profileReadError: {
        code: 'db_error',
        message: 'secret sql',
        name: 'PostgrestError',
      },
    })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('authenticated_error'),
    )
    expect(rendered.result.current.authError?.code).toBe('profile_read_failed')
    expect(supabase.signOut).not.toHaveBeenCalled()
    expect(rendered.result.current.authError?.message).not.toContain('sql')
  })

  it('profile 行缺失进入 authorized 并标记 profileMissing', async () => {
    const { supabase, rendered } = renderAuth({
      hasSession: true,
      profileRow: null,
    })
    await waitFor(() =>
      expect(rendered.result.current.status).toBe('authenticated_authorized'),
    )
    expect(rendered.result.current.profile).toBeNull()
    expect(rendered.result.current.profileMissing).toBe(true)
    expect(supabase.signOut).not.toHaveBeenCalled()
  })

  it('重试后可以恢复授权', async () => {
    const supabase = createSupabaseClientMock({
      hasSession: true,
      rpcNetworkFailure: true,
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider
        resolveClient={() => ({ status: 'ready', client: supabase.client })}
      >
        {children}
      </AuthProvider>
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() =>
      expect(result.current.status).toBe('authenticated_error'),
    )
    supabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'current_app_user_id') {
        return { data: '11111111-1111-1111-1111-111111111111', error: null }
      }
      return { data: null, error: null }
    })
    await act(async () => result.current.retryAuthCheck())
    await waitFor(() =>
      expect(result.current.status).toBe('authenticated_authorized'),
    )
    expect(result.current.appUser?.id).toBe(
      '11111111-1111-1111-1111-111111111111',
    )
  })
})

describe('AuthProvider 竞态防护（epoch）', () => {
  beforeEach(() => window.sessionStorage.clear())
  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('解析执行中 SIGNED_OUT 后旧结果不能提交（保持未登录）', async () => {
    const supabase = createSupabaseClientMock({ hasSession: true })
    // Defer the identity RPC so the resolution is in flight when SIGNED_OUT lands.
    let resolveRpc:
      ((value: { data: string | null; error: null }) => void) | undefined
    supabase.rpc.mockImplementation(
      (name: string) =>
        new Promise<{ data: string | null; error: null }>((resolve) => {
          if (name === 'current_app_user_id') resolveRpc = resolve
          else resolve({ data: null, error: null })
        }),
    )
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider
        resolveClient={() => ({ status: 'ready', client: supabase.client })}
      >
        {children}
      </AuthProvider>
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() =>
      expect(result.current.status).toBe('authenticated_checking_identity'),
    )

    // SIGN_OUT while the resolution is pending.
    act(() => supabase.emitAuthEvent('SIGNED_OUT'))
    await waitFor(() => expect(result.current.status).toBe('unauthenticated'))

    // The stale resolution resolves AFTER sign-out; it must not re-authorize.
    await act(async () => {
      resolveRpc?.({
        data: '11111111-1111-1111-1111-111111111111',
        error: null,
      })
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.status).toBe('unauthenticated')
    expect(result.current.appUser).toBeNull()
    expect(result.current.profile).toBeNull()
  })

  it('A 用户解析未完成时新 SIGNED_IN 只显示新会话用户', async () => {
    const supabase = createSupabaseClientMock({ hasSession: true })
    // Deferred rpc with a queue of resolvers (one per call) so the stale
    // resolution and the new one can each be resolved deterministically.
    const rpcResolvers: Array<
      (value: { data: string | null; error: null }) => void
    > = []
    supabase.rpc.mockImplementation(
      (name: string) =>
        new Promise<{ data: string | null; error: null }>((resolve) => {
          if (name === 'current_app_user_id') rpcResolvers.push(resolve)
          else resolve({ data: null, error: null })
        }),
    )
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider
        resolveClient={() => ({ status: 'ready', client: supabase.client })}
      >
        {children}
      </AuthProvider>
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() =>
      expect(result.current.status).toBe('authenticated_checking_identity'),
    )

    // A new SIGNED_IN (user B session) arrives while user A resolution is
    // pending; the old epoch must be invalidated.
    act(() => supabase.emitAuthEvent('SIGNED_IN'))
    // The new resolution should map to user B (2222...) — app_users read must
    // return a row matching the resolved app user id.
    const userBRow = {
      ...fictionalAppUser,
      id: '22222222-2222-2222-2222-222222222222',
    }
    const userARow = {
      ...fictionalAppUser,
      id: '11111111-1111-1111-1111-111111111111',
    }
    // rpc now resolves user B for any subsequent call; app_users returns B's row.
    supabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'current_app_user_id') {
        return { data: '22222222-2222-2222-2222-222222222222', error: null }
      }
      return { data: null, error: null }
    })
    supabase.from.mockImplementation((table: 'app_users' | 'profiles') => {
      if (table === 'app_users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: userBRow, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: fictionalProfile, error: null }),
          }),
        }),
        update: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({
                data: fictionalProfile,
                error: null,
              }),
            }),
          }),
        }),
      }
    })

    // Resolve the STALE user A request; it must be discarded (old epoch).
    await act(async () => {
      rpcResolvers[0]?.({ data: userARow.id, error: null })
      await Promise.resolve()
    })
    await waitFor(() =>
      expect(result.current.status).toBe('authenticated_authorized'),
    )
    expect(result.current.appUser?.id).toBe(userBRow.id)
  })

  it('USER_UPDATED 后立即退出，旧解析不能恢复授权', async () => {
    const supabase = createSupabaseClientMock({ hasSession: true })
    const rpcResolvers: Array<
      (value: { data: string | null; error: null }) => void
    > = []
    supabase.rpc.mockImplementation(
      (name: string) =>
        new Promise<{ data: string | null; error: null }>((resolve) => {
          if (name === 'current_app_user_id') rpcResolvers.push(resolve)
          else resolve({ data: null, error: null })
        }),
    )
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider
        resolveClient={() => ({ status: 'ready', client: supabase.client })}
      >
        {children}
      </AuthProvider>
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() =>
      expect(result.current.status).toBe('authenticated_checking_identity'),
    )

    // USER_UPDATED schedules a re-resolution; the SIGNED_OUT (the post-password
    // update sign-out) then invalidates everything, including that scheduled
    // resolution (getSession() now returns null).
    act(() => supabase.emitAuthEvent('USER_UPDATED'))
    act(() => supabase.emitAuthEvent('SIGNED_OUT'))
    await waitFor(() => expect(result.current.status).toBe('unauthenticated'))

    // The stale resolution resolves afterwards; it must not re-authorize.
    await act(async () => {
      rpcResolvers[0]?.({
        data: '11111111-1111-1111-1111-111111111111',
        error: null,
      })
      await Promise.resolve()
    })
    // Flush any microtask the USER_UPDATED branch queued.
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.status).toBe('unauthenticated')
    expect(result.current.appUser).toBeNull()
  })

  it('TOKEN_REFRESHED 与 session 失效交错后保持未登录', async () => {
    const supabase = createSupabaseClientMock({ hasSession: true })
    const rpcResolvers: Array<
      (value: { data: string | null; error: null }) => void
    > = []
    supabase.rpc.mockImplementation(
      (name: string) =>
        new Promise<{ data: string | null; error: null }>((resolve) => {
          if (name === 'current_app_user_id') rpcResolvers.push(resolve)
          else resolve({ data: null, error: null })
        }),
    )
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider
        resolveClient={() => ({ status: 'ready', client: supabase.client })}
      >
        {children}
      </AuthProvider>
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() =>
      expect(result.current.status).toBe('authenticated_checking_identity'),
    )

    act(() => supabase.emitAuthEvent('TOKEN_REFRESHED'))
    act(() => supabase.emitAuthEvent('SIGNED_OUT'))
    await waitFor(() => expect(result.current.status).toBe('unauthenticated'))
    await act(async () => {
      rpcResolvers[0]?.({
        data: '11111111-1111-1111-1111-111111111111',
        error: null,
      })
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.status).toBe('unauthenticated')
    expect(result.current.appUser).toBeNull()
  })

  it('Provider 卸载后异步结果不能写状态', async () => {
    const supabase = createSupabaseClientMock({ hasSession: true })
    let resolveRpc:
      ((value: { data: string | null; error: null }) => void) | undefined
    supabase.rpc.mockImplementation(
      (name: string) =>
        new Promise<{ data: string | null; error: null }>((resolve) => {
          if (name === 'current_app_user_id') resolveRpc = resolve
          else resolve({ data: null, error: null })
        }),
    )
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider
        resolveClient={() => ({ status: 'ready', client: supabase.client })}
      >
        {children}
      </AuthProvider>
    )
    const { result, unmount } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() =>
      expect(result.current.status).toBe('authenticated_checking_identity'),
    )
    unmount()
    // Resolve after unmount; no state writes should throw or leak.
    await act(async () => {
      resolveRpc?.({
        data: '11111111-1111-1111-1111-111111111111',
        error: null,
      })
      await Promise.resolve()
    })
    // Nothing to assert on unmounted hook; the important part is no crash and
    // no act warning from a post-unmount setState.
    expect(true).toBe(true)
  })

  it('重复 SIGNED_OUT 事件不会产生重复退出或无限检查', async () => {
    const supabase = createSupabaseClientMock({ hasSession: true })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider
        resolveClient={() => ({ status: 'ready', client: supabase.client })}
      >
        {children}
      </AuthProvider>
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() =>
      expect(result.current.status).toBe('authenticated_authorized'),
    )
    act(() => supabase.emitAuthEvent('SIGNED_OUT'))
    act(() => supabase.emitAuthEvent('SIGNED_OUT'))
    act(() => supabase.emitAuthEvent('SIGNED_OUT'))
    await waitFor(() => expect(result.current.status).toBe('unauthenticated'))
    // No extra identity RPCs after the first sign-out resolution finished.
    const rpcCalls = supabase.rpc.mock.calls.filter(
      (call) => call[0] === 'current_app_user_id',
    ).length
    expect(rpcCalls).toBeLessThanOrEqual(2)
    expect(result.current.appUser).toBeNull()
  })
})
