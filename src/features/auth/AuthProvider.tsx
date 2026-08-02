/**
 * AuthProvider: the single client-side authentication state layer.
 *
 * Status machine:
 *   initializing                     — restoring the persisted session
 *   unauthenticated                  — no usable Supabase session
 *   authenticated_checking_identity  — session exists, resolving app_user
 *   authenticated_authorized         — session + valid internal identity
 *   authenticated_unavailable        — CONFIRMED unusable identity (will sign out)
 *   authenticated_error              — recoverable safe error (network/config/
 *                                      profile read); NOT "account disabled"
 *
 * Authorization for business pages is decided ONLY after
 * `current_app_user_id()` resolves to an active, verified internal user and
 * the caller's own app_users/profile rows were read. The provider never treats
 * the Auth UUID as a business key and never lets a client-supplied user id or
 * subject reach the resolution boundary.
 *
 * STALE-RESULT PROTECTION (auth epoch):
 *   Every identity resolution captures a monotonically increasing epoch. All
 *   async stages and every state write re-check that the epoch is still the
 *   latest one AND that the provider is still mounted. SIGNED_OUT, explicit
 *   sign-out, account-unavailable sign-out, post-password-update sign-out and
 *   provider unmount immediately invalidate every in-flight resolution, so a
 *   stale request for user A can never overwrite user B's session or restore
 *   protected content after sign-out.
 *
 * Supabase docs warn against complex nested async work inside the
 * onAuthStateChange callback (it holds an internal lock), so the callback only
 * records intent; the actual async resolution is deferred out of the callback.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database.generated'
import { createSafeAuthError } from '@/features/auth/errors'
import {
  fetchCurrentAppUserId,
  fetchOwnAppUser,
  fetchOwnProfile,
  requestPasswordResetEmail,
  signInWithEmailAndPassword,
  signOutOfSupabase,
  updateOwnProfile,
  updateUserPassword,
  type AppUser,
  type AuthServiceResult,
  type Profile,
  type ProfileEditableInput,
  RECOVERY_SESSION_STORAGE_KEY,
} from '@/features/auth/authService'
import {
  AuthContext,
  type AuthConfigState,
  type AuthContextValue,
  type AuthStatus,
} from '@/features/auth/AuthContext'

const identityUnavailableMessage =
  '该账号尚未激活或暂不可使用，请联系系统管理员。'

const SIGN_OUT_SCOPE = 'local' as const

type AuthProviderProps = PropsWithChildren<{
  resolveClient?: () => ReturnType<typeof getSupabaseClient>
  recoveryStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}>

export function AuthProvider({
  children,
  resolveClient = getSupabaseClient,
  recoveryStorage = window.sessionStorage,
}: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>('initializing')
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileMissing, setProfileMissing] = useState(false)
  const [authError, setAuthError] =
    useState<AuthContextValue['authError']>(null)
  const [configState, setConfigState] = useState<AuthConfigState>(null)
  const [isRecoverySession, setIsRecoverySession] = useState(
    () => recoveryStorage.getItem(RECOVERY_SESSION_STORAGE_KEY) === '1',
  )
  const [notice, setNotice] = useState<string | null>(null)

  const clientRef = useRef<SupabaseClient<Database> | null>(null)
  const disposedRef = useRef(false)
  const appUserRef = useRef<AppUser | null>(null)
  /**
   * Monotonically increasing "auth epoch". Every authoritative state change
   * (sign-out, user switch, unmount, password update) bumps it so that any
   * in-flight resolution that captured an older epoch can no longer write.
   */
  const authEpochRef = useRef(0)

  const markRecoverySession = useCallback(() => {
    recoveryStorage.setItem(RECOVERY_SESSION_STORAGE_KEY, '1')
    setIsRecoverySession(true)
  }, [recoveryStorage])

  const clearRecoverySession = useCallback(() => {
    recoveryStorage.removeItem(RECOVERY_SESSION_STORAGE_KEY)
    setIsRecoverySession(false)
  }, [recoveryStorage])

  const invalidateAuthEpoch = useCallback(() => {
    authEpochRef.current += 1
  }, [])

  const clearLocalAuthState = useCallback(() => {
    setAppUser(null)
    appUserRef.current = null
    setProfile(null)
    setProfileMissing(false)
    setAuthError(null)
    clearRecoverySession()
    setStatus('unauthenticated')
  }, [clearRecoverySession])

  /** True when the resolution captured by `epoch` is still the latest one. */
  const isCurrentEpoch = useCallback(
    (epoch: number) => !disposedRef.current && epoch === authEpochRef.current,
    [],
  )

  /**
   * Set the recoverable-error state without touching the session or the user
   * data, and without a permanent sign-out.
   */
  const enterRecoverableError = useCallback(
    (error: AuthContextValue['authError']) => {
      setAuthError(error)
      setAppUser(null)
      appUserRef.current = null
      setProfile(null)
      setProfileMissing(false)
      setStatus('authenticated_error')
    },
    [],
  )

  /**
   * Confirmed account-unavailable: the identity resolution returned a
   * definitive "no usable internal identity". Centralized sign-out lives here
   * (explicit local scope); route components must NOT sign out during render.
   */
  const handleConfirmedUnavailable = useCallback(
    async (client: SupabaseClient<Database>) => {
      invalidateAuthEpoch()
      setAuthError(null)
      setAppUser(null)
      appUserRef.current = null
      setProfile(null)
      setProfileMissing(false)
      setNotice(identityUnavailableMessage)
      setStatus('authenticated_unavailable')
      await signOutOfSupabase(client, SIGN_OUT_SCOPE)
      if (!disposedRef.current) {
        clearLocalAuthState()
      }
    },
    [clearLocalAuthState, invalidateAuthEpoch],
  )

  /**
   * Resolve the current session to an authorized internal user, or handle the
   * unavailable / recoverable-error cases. Every async stage and state write
   * is guarded by the epoch captured at the start.
   */
  const resolveIdentity = useCallback(
    async (
      client: SupabaseClient<Database>,
      options?: { isRecovery?: boolean },
    ): Promise<AuthServiceResult> => {
      const epoch = authEpochRef.current
      if (!isCurrentEpoch(epoch)) {
        return {
          ok: false,
          error: createSafeAuthError('session_expired'),
        }
      }
      setStatus('authenticated_checking_identity')
      setAuthError(null)

      let sessionResult: Awaited<
        ReturnType<SupabaseClient<Database>['auth']['getSession']>
      >
      try {
        sessionResult = await client.auth.getSession()
      } catch {
        if (isCurrentEpoch(epoch)) {
          enterRecoverableError(createSafeAuthError('network_unavailable'))
        }
        return {
          ok: false,
          error: createSafeAuthError('network_unavailable'),
        }
      }
      if (!isCurrentEpoch(epoch)) {
        return { ok: false, error: createSafeAuthError('session_expired') }
      }
      const session = sessionResult.data?.session
      if (!session) {
        setStatus('unauthenticated')
        return { ok: false, error: createSafeAuthError('session_expired') }
      }

      const appUserIdResult = await fetchCurrentAppUserId(client)
      if (!isCurrentEpoch(epoch)) {
        return { ok: false, error: createSafeAuthError('session_expired') }
      }
      if (!appUserIdResult.ok) {
        // RPC / network failure: recoverable, NOT account-unavailable.
        enterRecoverableError(appUserIdResult.error)
        return { ok: false, error: appUserIdResult.error }
      }
      const appUserId = appUserIdResult.data
      if (!appUserId) {
        if (options?.isRecovery) {
          // Recovery sessions may exist before an internal identity is bound;
          // keep the recovery flow working without authorizing business pages.
          setStatus('authenticated_unavailable')
          return {
            ok: false,
            error: createSafeAuthError('identity_unavailable'),
          }
        }
        await handleConfirmedUnavailable(client)
        return {
          ok: false,
          error: createSafeAuthError('identity_unavailable'),
        }
      }

      const ownUserResult = await fetchOwnAppUser(client, appUserId)
      if (!isCurrentEpoch(epoch)) {
        return { ok: false, error: createSafeAuthError('session_expired') }
      }
      if (!ownUserResult.ok) {
        // DB read failure: recoverable temporary error, no permanent sign-out.
        enterRecoverableError(ownUserResult.error)
        return { ok: false, error: ownUserResult.error }
      }
      if (!ownUserResult.data) {
        // Query succeeded but there is no own app_users row — treat as
        // confirmed unavailable (data-integrity / identity state).
        await handleConfirmedUnavailable(client)
        return {
          ok: false,
          error: createSafeAuthError('identity_unavailable'),
        }
      }

      const ownProfileResult = await fetchOwnProfile(client, appUserId)
      if (!isCurrentEpoch(epoch)) {
        return { ok: false, error: createSafeAuthError('session_expired') }
      }
      if (!ownProfileResult.ok) {
        // Profile read failed: do NOT enter authorized (the settings page
        // would spin forever); surface a recoverable error instead.
        enterRecoverableError(ownProfileResult.error)
        return { ok: false, error: ownProfileResult.error }
      }

      if (!isCurrentEpoch(epoch)) {
        return { ok: false, error: createSafeAuthError('session_expired') }
      }
      setAppUser(ownUserResult.data)
      appUserRef.current = ownUserResult.data
      setProfile(ownProfileResult.data)
      setProfileMissing(ownProfileResult.data === null)
      setStatus('authenticated_authorized')
      return { ok: true, data: undefined }
    },
    [enterRecoverableError, handleConfirmedUnavailable, isCurrentEpoch],
  )

  // Initial session restore + subscription.
  useEffect(() => {
    disposedRef.current = false
    const resolution = resolveClient()
    if (resolution.status !== 'ready') {
      // Preserve the unconfigured vs invalid distinction. Deferred via
      // queueMicrotask so the state update never runs synchronously inside the
      // effect body, while remaining flushable by `act(async ...)` in tests.
      queueMicrotask(() => {
        if (!disposedRef.current) {
          setConfigState(resolution.reason)
          setAuthError(
            resolution.reason === 'invalid'
              ? createSafeAuthError('supabase_config_invalid')
              : createSafeAuthError('supabase_unconfigured'),
          )
          setStatus('authenticated_error')
        }
      })
      return
    }
    queueMicrotask(() => {
      if (!disposedRef.current) setConfigState(null)
    })
    const client = resolution.client
    clientRef.current = client

    void client.auth
      .getSession()
      .then(({ data }) => {
        if (disposedRef.current) return
        if (!data.session) {
          setStatus('unauthenticated')
          return
        }
        const wasRecovery =
          recoveryStorage.getItem(RECOVERY_SESSION_STORAGE_KEY) === '1'
        // Defer out of the promise chain so the auth lock is free.
        queueMicrotask(() => {
          if (disposedRef.current) return
          void resolveIdentity(client, { isRecovery: wasRecovery })
        })
      })
      .catch(() => {
        if (!disposedRef.current) setStatus('unauthenticated')
      })

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event) => {
      if (disposedRef.current) return
      if (event === 'SIGNED_OUT') {
        // Token refresh failure, user deletion and explicit sign-out all land
        // here; the UI must drop protected content immediately and every
        // in-flight resolution becomes stale.
        invalidateAuthEpoch()
        clearLocalAuthState()
        return
      }
      if (event === 'PASSWORD_RECOVERY') {
        markRecoverySession()
        invalidateAuthEpoch()
        queueMicrotask(() => {
          if (disposedRef.current) return
          void resolveIdentity(client, { isRecovery: true })
        })
        return
      }
      if (event === 'SIGNED_IN') {
        // A normal sign-in is not a recovery session; any earlier resolution
        // for the previous user must be invalidated.
        clearRecoverySession()
        invalidateAuthEpoch()
        queueMicrotask(() => {
          if (disposedRef.current) return
          void resolveIdentity(client)
        })
        return
      }
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        // Session remains valid; re-verify identity so revoked/suspended
        // users are dropped as soon as the boundary reflects it. A USER_UPDATED
        // that precedes the post-password-update sign-out must not re-authorize
        // after sign-out — the SIGNED_OUT epoch bump handles that.
        invalidateAuthEpoch()
        queueMicrotask(() => {
          if (disposedRef.current) return
          void resolveIdentity(client, {
            isRecovery:
              recoveryStorage.getItem(RECOVERY_SESSION_STORAGE_KEY) === '1',
          })
        })
      }
    })

    return () => {
      disposedRef.current = true
      invalidateAuthEpoch()
      subscription.unsubscribe()
    }
  }, [
    clearLocalAuthState,
    clearRecoverySession,
    invalidateAuthEpoch,
    markRecoverySession,
    recoveryStorage,
    resolveClient,
    resolveIdentity,
  ])

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthServiceResult> => {
      const client = clientRef.current
      if (!client) {
        return {
          ok: false,
          error: createSafeAuthError(
            configState === 'invalid'
              ? 'supabase_config_invalid'
              : 'supabase_unconfigured',
          ),
        }
      }
      setNotice(null)
      const result = await signInWithEmailAndPassword(client, email, password)
      if (!result.ok) return result
      // Do NOT run a second identity resolution here: signInWithPassword
      // emits SIGNED_IN (both in the real client and in the test mock), and
      // the subscription schedules the authoritative resolveIdentity. A manual
      // second call would race it (the first resolution to finish would bump
      // the epoch and make the other return a stale error). Return success and
      // let the event-driven resolution decide the final status.
      return { ok: true, data: undefined }
    },
    [configState],
  )

  const signOut = useCallback(async () => {
    const client = clientRef.current
    invalidateAuthEpoch()
    if (client) {
      await signOutOfSupabase(client, SIGN_OUT_SCOPE)
    }
    if (!disposedRef.current) {
      clearLocalAuthState()
    }
  }, [clearLocalAuthState, invalidateAuthEpoch])

  const requestPasswordReset = useCallback(
    async (email: string): Promise<AuthServiceResult> => {
      const client = clientRef.current
      if (!client) {
        return {
          ok: false,
          error: createSafeAuthError(
            configState === 'invalid'
              ? 'supabase_config_invalid'
              : 'supabase_unconfigured',
          ),
        }
      }
      setNotice(null)
      // Controlled in-app redirect target; never accepts a caller-supplied URL.
      const redirectTo = `${window.location.origin}/reset-password`
      return requestPasswordResetEmail(client, email, redirectTo)
    },
    [configState],
  )

  const updatePassword = useCallback(
    async (password: string): Promise<AuthServiceResult> => {
      const client = clientRef.current
      if (!client) {
        return {
          ok: false,
          error: createSafeAuthError(
            configState === 'invalid'
              ? 'supabase_config_invalid'
              : 'supabase_unconfigured',
          ),
        }
      }
      const result = await updateUserPassword(client, password)
      if (!result.ok) return result
      // Clean up the recovery state and local session; the login page shows
      // the success notice via `notice`. The epoch bump here invalidates any
      // USER_UPDATED-triggered resolution that could otherwise re-authorize
      // after the sign-out below.
      setNotice('密码已更新，请使用新密码登录。')
      clearRecoverySession()
      invalidateAuthEpoch()
      await signOutOfSupabase(client, SIGN_OUT_SCOPE)
      if (!disposedRef.current) {
        clearLocalAuthState()
      }
      return { ok: true, data: undefined }
    },
    [
      clearLocalAuthState,
      clearRecoverySession,
      configState,
      invalidateAuthEpoch,
    ],
  )

  const updateProfile = useCallback(
    async (
      input: ProfileEditableInput,
    ): Promise<AuthServiceResult<Profile>> => {
      const client = clientRef.current
      if (!client) {
        return {
          ok: false,
          error: createSafeAuthError(
            configState === 'invalid'
              ? 'supabase_config_invalid'
              : 'supabase_unconfigured',
          ),
        }
      }
      const appUserId = appUserRef.current?.id
      if (!appUserId) {
        return {
          ok: false,
          error: createSafeAuthError('identity_unavailable'),
        }
      }
      const result = await updateOwnProfile(client, appUserId, input)
      if (result.ok) {
        setProfile(result.data)
        setProfileMissing(false)
      }
      return result
    },
    [configState],
  )

  const refreshProfile = useCallback(async () => {
    const client = clientRef.current
    const appUserId = appUserRef.current?.id
    if (!client || !appUserId) return
    const fresh = await fetchOwnProfile(client, appUserId)
    if (fresh.ok && fresh.data) {
      setProfile(fresh.data)
      setProfileMissing(false)
    }
  }, [])

  const retryAuthCheck = useCallback(() => {
    const client = clientRef.current
    if (!client) return
    invalidateAuthEpoch()
    void resolveIdentity(client)
  }, [invalidateAuthEpoch, resolveIdentity])

  const clearNotice = useCallback(() => setNotice(null), [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      appUser,
      profile,
      authError,
      profileMissing,
      configState,
      isRecoverySession,
      notice,
      clearNotice,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      updateProfile,
      refreshProfile,
      retryAuthCheck,
    }),
    [
      status,
      appUser,
      profile,
      authError,
      profileMissing,
      configState,
      isRecoverySession,
      notice,
      clearNotice,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      updateProfile,
      refreshProfile,
      retryAuthCheck,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
