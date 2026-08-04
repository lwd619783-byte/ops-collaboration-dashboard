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
  ACTIVATION_PHASE_STORAGE_KEY,
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
  const [activationPasswordSet, setActivationPasswordSet] = useState(
    () => recoveryStorage.getItem(ACTIVATION_PHASE_STORAGE_KEY) === '1',
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

  /**
   * First-activation phase marker. `setInitialPassword` marks it ONLY after
   * the password update succeeded, so a failed update can never be mistaken
   * for "password already set". The marker is a plain boolean in controlled
   * sessionStorage: it survives USER_UPDATED-triggered identity re-resolution
   * and page refreshes, and never contains a password, token or invite link.
   */
  const markActivationPasswordSet = useCallback(() => {
    recoveryStorage.setItem(ACTIVATION_PHASE_STORAGE_KEY, '1')
    setActivationPasswordSet(true)
  }, [recoveryStorage])

  const clearActivationPhase = useCallback(() => {
    recoveryStorage.removeItem(ACTIVATION_PHASE_STORAGE_KEY)
    setActivationPasswordSet(false)
  }, [recoveryStorage])

  const invalidateAuthEpoch = useCallback(() => {
    authEpochRef.current += 1
  }, [])

  /**
   * ATOMIC "session is gone" transition (fix #1): clears EVERY piece of local
   * auth state — appUser, appUserRef, profile, profileMissing, authError, the
   * recovery marker + isRecoverySession — and sets status to `unauthenticated`.
   * It first invalidates the auth epoch so every in-flight identity resolution
   * becomes stale and can never re-write an authorized state afterwards.
   *
   * This must be used for session-loss detection (getSession() → null) and for
   * the local half of every sign-out, so that a stale user's data can never
   * survive a transition and a normal session expiry is never reported as an
   * account being disabled.
   */
  const transitionToUnauthenticated = useCallback(() => {
    invalidateAuthEpoch()
    setAppUser(null)
    appUserRef.current = null
    setProfile(null)
    setProfileMissing(false)
    setAuthError(null)
    clearRecoverySession()
    // The first-activation phase is bound to this session: session loss and
    // every sign-out must drop it so it can never leak to another user.
    clearActivationPhase()
    setStatus('unauthenticated')
  }, [clearActivationPhase, clearRecoverySession, invalidateAuthEpoch])

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
   *
   * Sign-out ordering (fix #2):
   *   1. Invalidate the epoch and clear the local user data IMMEDIATELY — the
   *      UI must never keep showing protected content while the network
   *      sign-out is in flight, even if that call fails.
   *   2. best-effort `signOutOfSupabase` afterwards.
   *   3. After the await, finish the transition ONLY if this transition's
   *      epoch is still current. If a new SIGNED_IN / PASSWORD_RECOVERY /
   *      other authoritative event landed meanwhile, the new session owns the
   *      state and this stale sign-out must NOT overwrite it.
   */
  const handleConfirmedUnavailable = useCallback(
    async (client: SupabaseClient<Database>) => {
      invalidateAuthEpoch()
      const transitionEpoch = authEpochRef.current
      // Local data (including the recovery marker) is cleared IMMEDIATELY so
      // protected content never lingers while the network sign-out is in
      // flight. The notice is kept so the login page can show the unified
      // "account unavailable" message.
      setAuthError(null)
      setAppUser(null)
      appUserRef.current = null
      setProfile(null)
      setProfileMissing(false)
      clearRecoverySession()
      setNotice(identityUnavailableMessage)
      setStatus('authenticated_unavailable')
      await signOutOfSupabase(client, SIGN_OUT_SCOPE)
      if (isCurrentEpoch(transitionEpoch)) {
        setStatus('unauthenticated')
      }
    },
    [clearRecoverySession, invalidateAuthEpoch, isCurrentEpoch],
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
        // Session is gone (expired / revoked / user deleted). Atomically clear
        // EVERY piece of local auth state — never just flip the status, and
        // never report a plain session expiry as an account being disabled.
        transitionToUnauthenticated()
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
          // Recovery-only session: the user may set a new password even though
          // no internal identity is resolvable yet. Keep the recovery session
          // (marker + isRecoverySession) and mark the state explicitly so
          // business routes redirect to /reset-password instead of showing a
          // permanent "signing out" state or authorizing protected content.
          // NO account-unavailable sign-out happens here.
          setStatus('authenticated_recovery_only')
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
    [
      enterRecoverableError,
      handleConfirmedUnavailable,
      isCurrentEpoch,
      transitionToUnauthenticated,
    ],
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
          transitionToUnauthenticated()
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
        if (!disposedRef.current) transitionToUnauthenticated()
      })

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event) => {
      if (disposedRef.current) return
      if (event === 'SIGNED_OUT') {
        // Token refresh failure, user deletion and explicit sign-out all land
        // here; the UI must drop protected content immediately and every
        // in-flight resolution becomes stale.
        transitionToUnauthenticated()
        return
      }
      if (event === 'PASSWORD_RECOVERY') {
        markRecoverySession()
        // A recovery session is a different flow: any in-progress first
        // activation for the previous session must be dropped.
        clearActivationPhase()
        invalidateAuthEpoch()
        queueMicrotask(() => {
          if (disposedRef.current) return
          void resolveIdentity(client, { isRecovery: true })
        })
        return
      }
      if (event === 'SIGNED_IN') {
        // A normal sign-in (new user, new session) is not an activation
        // continuation: earlier resolutions AND any stale activation phase
        // for the previous user must be invalidated.
        clearRecoverySession()
        clearActivationPhase()
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
    clearActivationPhase,
    clearRecoverySession,
    invalidateAuthEpoch,
    markRecoverySession,
    recoveryStorage,
    resolveClient,
    resolveIdentity,
    transitionToUnauthenticated,
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

  /**
   * Explicit user sign-out (fix #2). Ordering:
   *   1. transitionToUnauthenticated() FIRST — atomically clears every piece
   *      of local auth state and invalidates the epoch, so protected content
   *      disappears immediately, before any network call.
   *   2. best-effort Supabase sign-out afterwards (explicit local scope).
   *   3. After the await, NO unconditional state write happens. If a new
   *      SIGNED_IN (user B) landed while the network sign-out was in flight,
   *      its epoch owns the state; this stale sign-out must not clear it.
   *      The SIGNED_OUT event (if the client emits one) is idempotent with
   *      the local transition we already performed.
   */
  const signOut = useCallback(async () => {
    const client = clientRef.current
    transitionToUnauthenticated()
    if (client) {
      await signOutOfSupabase(client, SIGN_OUT_SCOPE)
    }
  }, [transitionToUnauthenticated])

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
      // the success notice via `notice`.
      // Ordering (fix #2): set the notice and atomically clear local state
      // IMMEDIATELY (epoch bump included) so a USER_UPDATED-triggered
      // resolution cannot re-authorize, then best-effort sign-out. After the
      // await we only finish the transition if this epoch is still current —
      // a new sign-in must not be cleared by this stale password-update exit.
      setNotice('密码已更新，请使用新密码登录。')
      invalidateAuthEpoch()
      const transitionEpoch = authEpochRef.current
      transitionToUnauthenticated()
      await signOutOfSupabase(client, SIGN_OUT_SCOPE)
      if (isCurrentEpoch(transitionEpoch)) {
        // Idempotent with the transition above / any SIGNED_OUT event.
        setStatus('unauthenticated')
      }
      return { ok: true, data: undefined }
    },
    [
      configState,
      invalidateAuthEpoch,
      isCurrentEpoch,
      transitionToUnauthenticated,
    ],
  )

  const setInitialPassword = useCallback(
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
      // Invitation activation must keep the verified invite session alive long
      // enough to accept the workspace invitation. The activation page signs
      // out explicitly only after both steps have succeeded.
      const result = await updateUserPassword(client, password)
      if (!result.ok) return result
      // Mark the phase ONLY after the password update succeeded. The marker
      // survives the USER_UPDATED re-resolution and page refreshes, so the
      // activation page can never ask for the password twice.
      markActivationPasswordSet()
      return result
    },
    [configState, markActivationPasswordSet],
  )

  const completeAccountActivationSignOut = useCallback(async () => {
    const client = clientRef.current
    transitionToUnauthenticated()
    setNotice('账号已激活，请使用新密码登录。')
    if (client) await signOutOfSupabase(client, SIGN_OUT_SCOPE)
  }, [transitionToUnauthenticated])

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
      activationPasswordSet,
      notice,
      clearNotice,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      setInitialPassword,
      completeAccountActivationSignOut,
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
      activationPasswordSet,
      notice,
      clearNotice,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      setInitialPassword,
      completeAccountActivationSignOut,
      updateProfile,
      refreshProfile,
      retryAuthCheck,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
