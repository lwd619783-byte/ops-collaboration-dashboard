/**
 * AuthProvider: the single client-side authentication state layer.
 *
 * Status machine:
 *   initializing                     — restoring the persisted session
 *   unauthenticated                  — no usable Supabase session
 *   authenticated_checking_identity  — session exists, resolving app_user
 *   authenticated_authorized         — session + valid internal identity
 *   authenticated_unavailable        — session exists but identity unusable
 *
 * Authorization for business pages is decided ONLY after
 * `current_app_user_id()` resolves to an active, verified internal user and
 * the caller's own app_users/profile rows were read. The provider never treats
 * the Auth UUID as a business key and never lets a client-supplied user id or
 * subject reach the resolution boundary.
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
  type AuthContextValue,
  type AuthStatus,
} from '@/features/auth/AuthContext'

const identityUnavailableMessage =
  '该账号尚未激活或暂不可使用，请联系系统管理员。'

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
  const [isRecoverySession, setIsRecoverySession] = useState(
    () => recoveryStorage.getItem(RECOVERY_SESSION_STORAGE_KEY) === '1',
  )
  const [notice, setNotice] = useState<string | null>(null)

  const clientRef = useRef<SupabaseClient<Database> | null>(null)
  const resolvingRef = useRef(false)
  const disposedRef = useRef(false)
  const appUserRef = useRef<AppUser | null>(null)

  const markRecoverySession = useCallback(() => {
    recoveryStorage.setItem(RECOVERY_SESSION_STORAGE_KEY, '1')
    setIsRecoverySession(true)
  }, [recoveryStorage])

  const clearRecoverySession = useCallback(() => {
    recoveryStorage.removeItem(RECOVERY_SESSION_STORAGE_KEY)
    setIsRecoverySession(false)
  }, [recoveryStorage])

  const clearLocalAuthState = useCallback(() => {
    setAppUser(null)
    appUserRef.current = null
    setProfile(null)
    clearRecoverySession()
    setStatus('unauthenticated')
  }, [clearRecoverySession])

  const handleUnavailable = useCallback(
    async (client: SupabaseClient<Database>) => {
      setStatus('authenticated_unavailable')
      setNotice(identityUnavailableMessage)
      await signOutOfSupabase(client)
      if (!disposedRef.current) {
        clearLocalAuthState()
      }
    },
    [clearLocalAuthState],
  )

  /**
   * Resolve the current session to an authorized internal user, or handle the
   * unavailable case. Runs the heavy async work; guarded against races.
   */
  const resolveIdentity = useCallback(
    async (
      client: SupabaseClient<Database>,
      options?: { isRecovery?: boolean },
    ): Promise<AuthServiceResult> => {
      if (resolvingRef.current) {
        return { ok: false, error: createSafeAuthError('identity_unavailable') }
      }
      resolvingRef.current = true
      try {
        setStatus('authenticated_checking_identity')
        const { data: sessionResult } = await client.auth.getSession()
        const session = sessionResult?.session
        if (!session) {
          setStatus('unauthenticated')
          return { ok: false, error: createSafeAuthError('session_expired') }
        }

        const appUserId = await fetchCurrentAppUserId(client)
        if (!appUserId) {
          if (options?.isRecovery) {
            // Recovery sessions may exist before an internal identity is
            // bound; keep the recovery flow working without authorizing the
            // business pages.
            setStatus('authenticated_unavailable')
            return {
              ok: false,
              error: createSafeAuthError('identity_unavailable'),
            }
          }
          await handleUnavailable(client)
          return {
            ok: false,
            error: createSafeAuthError('identity_unavailable'),
          }
        }

        const [ownUser, ownProfile] = await Promise.all([
          fetchOwnAppUser(client, appUserId),
          fetchOwnProfile(client, appUserId),
        ])
        if (!ownUser) {
          await handleUnavailable(client)
          return {
            ok: false,
            error: createSafeAuthError('identity_unavailable'),
          }
        }

        setAppUser(ownUser)
        appUserRef.current = ownUser
        setProfile(ownProfile)
        setStatus('authenticated_authorized')
        return { ok: true, data: undefined }
      } catch {
        setStatus('unauthenticated')
        return { ok: false, error: createSafeAuthError('unknown') }
      } finally {
        resolvingRef.current = false
      }
    },
    [handleUnavailable],
  )

  // Initial session restore + subscription.
  useEffect(() => {
    disposedRef.current = false
    const resolution = resolveClient()
    if (resolution.status !== 'ready') {
      // Unconfigured / invalid config: nothing to restore. Login pages render
      // the safe unconfigured state via their own checks. Deferred so the
      // state update never runs synchronously inside the effect body.
      window.setTimeout(() => {
        if (!disposedRef.current) setStatus('unauthenticated')
      }, 0)
      return
    }
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
        window.setTimeout(() => {
          if (disposedRef.current) return
          void resolveIdentity(client, { isRecovery: wasRecovery })
        }, 0)
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
        // here; the UI must drop protected content immediately.
        clearLocalAuthState()
        return
      }
      if (event === 'PASSWORD_RECOVERY') {
        markRecoverySession()
        // Defer identity resolution: a recovery session is allowed before an
        // internal binding exists, and we must not block the callback.
        window.setTimeout(() => {
          if (disposedRef.current) return
          void resolveIdentity(client, { isRecovery: true })
        }, 0)
        return
      }
      if (event === 'SIGNED_IN') {
        // A normal sign-in is not a recovery session.
        clearRecoverySession()
        window.setTimeout(() => {
          if (disposedRef.current) return
          void resolveIdentity(client)
        }, 0)
        return
      }
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        // Session remains valid; re-verify identity so revoked/suspended
        // users are dropped as soon as the boundary reflects it.
        window.setTimeout(() => {
          if (disposedRef.current) return
          void resolveIdentity(client, {
            isRecovery:
              recoveryStorage.getItem(RECOVERY_SESSION_STORAGE_KEY) === '1',
          })
        }, 0)
      }
    })

    return () => {
      disposedRef.current = true
      subscription.unsubscribe()
    }
  }, [
    clearLocalAuthState,
    clearRecoverySession,
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
          error: createSafeAuthError('supabase_unconfigured'),
        }
      }
      setNotice(null)
      const result = await signInWithEmailAndPassword(client, email, password)
      if (!result.ok) return result
      // Now validate the internal identity BEFORE the caller may navigate.
      return resolveIdentity(client)
    },
    [resolveIdentity],
  )

  const signOut = useCallback(async () => {
    const client = clientRef.current
    if (client) {
      await signOutOfSupabase(client)
    }
    if (!disposedRef.current) {
      clearLocalAuthState()
    }
  }, [clearLocalAuthState])

  const requestPasswordReset = useCallback(
    async (email: string): Promise<AuthServiceResult> => {
      const client = clientRef.current
      if (!client) {
        return {
          ok: false,
          error: createSafeAuthError('supabase_unconfigured'),
        }
      }
      setNotice(null)
      // Controlled in-app redirect target; never accepts a caller-supplied URL.
      const redirectTo = `${window.location.origin}/reset-password`
      return requestPasswordResetEmail(client, email, redirectTo)
    },
    [],
  )

  const updatePassword = useCallback(
    async (password: string): Promise<AuthServiceResult> => {
      const client = clientRef.current
      if (!client) {
        return {
          ok: false,
          error: createSafeAuthError('supabase_unconfigured'),
        }
      }
      const result = await updateUserPassword(client, password)
      if (!result.ok) return result
      // Clean up the recovery state and local session; the login page shows
      // the success notice via `notice`.
      setNotice('密码已更新，请使用新密码登录。')
      clearRecoverySession()
      await signOutOfSupabase(client)
      if (!disposedRef.current) {
        clearLocalAuthState()
      }
      return { ok: true, data: undefined }
    },
    [clearLocalAuthState, clearRecoverySession],
  )

  const updateProfile = useCallback(
    async (
      input: ProfileEditableInput,
    ): Promise<AuthServiceResult<Profile>> => {
      const client = clientRef.current
      if (!client) {
        return {
          ok: false,
          error: createSafeAuthError('supabase_unconfigured'),
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
      }
      return result
    },
    [],
  )

  const refreshProfile = useCallback(async () => {
    const client = clientRef.current
    const appUserId = appUserRef.current?.id
    if (!client || !appUserId) return
    const fresh = await fetchOwnProfile(client, appUserId)
    if (fresh) setProfile(fresh)
  }, [])

  const clearNotice = useCallback(() => setNotice(null), [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      appUser,
      profile,
      isRecoverySession,
      notice,
      clearNotice,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      updateProfile,
      refreshProfile,
    }),
    [
      status,
      appUser,
      profile,
      isRecoverySession,
      notice,
      clearNotice,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      updateProfile,
      refreshProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
