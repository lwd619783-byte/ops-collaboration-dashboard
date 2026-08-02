/**
 * Shared Supabase client mock for auth tests.
 *
 * The mock exposes `vi.fn()` implementations so tests can assert the REAL
 * arguments passed to signIn / signOut / resetPasswordForEmail / updateUser /
 * rpc / table reads. Like the real Supabase client, sign-in emits SIGNED_IN,
 * password update emits USER_UPDATED and sign-out emits SIGNED_OUT through the
 * registered onAuthStateChange listeners, so the AuthProvider subscription and
 * its concurrency logic are exercised with realistic event ordering.
 *
 * Tests may also emit events manually via `emitAuthEvent`, and may replace any
 * method implementation (e.g. with a controllable deferred promise) through
 * the exposed `vi.fn` handles.
 */

import { vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.generated'

export const FICTIONAL_AUTH_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
export const FICTIONAL_APP_USER_ID = '11111111-1111-1111-1111-111111111111'
export const FICTIONAL_ISSUER = 'https://fictional-issuer.example.local'

export const fictionalSession = {
  access_token: 'fixture.access.token',
  refresh_token: 'fixture.refresh.token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 4102444800,
  user: {
    id: FICTIONAL_AUTH_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'fixture@example.local',
    app_metadata: { provider: 'email' },
    user_metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    identities: [],
  },
} as const

export const fictionalAppUser = {
  id: FICTIONAL_APP_USER_ID,
  status: 'active',
  created_at: '2026-01-01T00:00:00+00:00',
  updated_at: '2026-01-01T00:00:00+00:00',
  disabled_at: null,
  merged_into_user_id: null,
} as const

export const fictionalProfile = {
  user_id: FICTIONAL_APP_USER_ID,
  display_name: 'Fictional User A',
  organization_name: 'Fictional Org',
  title: 'Fictional Title',
  avatar_url: null,
  contact_info: null,
  created_at: '2026-01-01T00:00:00+00:00',
  updated_at: '2026-01-01T00:00:00+00:00',
} as const

export type AuthEventName =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY'

export type MockClientOptions = {
  hasSession?: boolean
  session?: typeof fictionalSession | null
  /** Return value of rpc('current_app_user_id'); null → identity unavailable */
  currentAppUserId?: string | null
  /** rpc('current_app_user_id') error object */
  currentAppUserIdError?: unknown
  /** rpc('current_app_user_id') network-like failure */
  rpcNetworkFailure?: boolean
  /** app_users read error */
  appUserReadError?: unknown
  /** app_users row returned by read; null → row missing */
  appUserRow?: typeof fictionalAppUser | null
  /** profiles read error */
  profileReadError?: unknown
  /** profiles row returned by read; null → row missing */
  profileRow?: typeof fictionalProfile | null
  /** Throw a network-like failure on auth calls */
  networkFailure?: boolean
  /** error object returned by signInWithPassword */
  signInError?: unknown
  /** error object returned by resetPasswordForEmail */
  resetError?: unknown
  /** error object returned by updateUser */
  updateUserError?: unknown
  /** error object returned by profile update */
  profileUpdateError?: unknown
}

export type SupabaseClientMock = {
  client: SupabaseClient<Database>
  emitAuthEvent: (event: AuthEventName) => void
  authEventListeners: Array<(event: AuthEventName) => void>
  signInWithPassword: ReturnType<typeof vi.fn>
  signOut: ReturnType<typeof vi.fn>
  resetPasswordForEmail: ReturnType<typeof vi.fn>
  updateUser: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
  from: ReturnType<typeof vi.fn>
  getSession: ReturnType<typeof vi.fn>
}

function tableQuery(
  options: MockClientOptions,
  table: 'app_users' | 'profiles',
) {
  const readResult =
    table === 'app_users'
      ? options.appUserReadError
        ? { data: null, error: options.appUserReadError }
        : {
            data:
              options.appUserRow === undefined
                ? fictionalAppUser
                : options.appUserRow,
            error: null,
          }
      : options.profileReadError
        ? { data: null, error: options.profileReadError }
        : {
            data:
              options.profileRow === undefined
                ? fictionalProfile
                : options.profileRow,
            error: null,
          }

  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => {
          if (options.networkFailure) throw new Error('Failed to fetch')
          return readResult
        }),
      })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn(async () => {
            if (options.profileUpdateError) {
              return { data: null, error: options.profileUpdateError }
            }
            return {
              data:
                options.profileRow === undefined
                  ? fictionalProfile
                  : options.profileRow,
              error: null,
            }
          }),
        })),
      })),
    })),
  }
}

export function createSupabaseClientMock(
  options: MockClientOptions = {},
): SupabaseClientMock {
  const authEventListeners: Array<(event: AuthEventName) => void> = []
  let hasSessionState =
    options.hasSession === undefined ? false : options.hasSession

  const emit = (event: AuthEventName) => {
    // Mirror the real client: SIGNED_OUT implies the session is gone, so any
    // later getSession() must return null even if the event was emitted
    // directly by the test (not through signOut()).
    if (event === 'SIGNED_OUT') {
      hasSessionState = false
    }
    for (const listener of authEventListeners) listener(event)
  }

  const getSession = vi.fn(async () => {
    if (options.networkFailure) throw new Error('Failed to fetch')
    const session = hasSessionState
      ? (options.session ?? fictionalSession)
      : null
    return { data: { session }, error: null }
  })

  const signInWithPassword = vi.fn(async () => {
    if (options.networkFailure) throw new Error('Failed to fetch')
    if (options.signInError)
      return { data: { user: null }, error: options.signInError }
    hasSessionState = true
    emit('SIGNED_IN')
    return { data: { user: fictionalSession.user }, error: null }
  })

  const signOut = vi.fn(async () => {
    if (options.networkFailure) throw new Error('Failed to fetch')
    hasSessionState = false
    emit('SIGNED_OUT')
    return { error: null }
  })

  const resetPasswordForEmail = vi.fn(async () => {
    if (options.networkFailure) throw new Error('Failed to fetch')
    if (options.resetError) return { data: null, error: options.resetError }
    return { data: null, error: null }
  })

  const updateUser = vi.fn(async () => {
    if (options.networkFailure) throw new Error('Failed to fetch')
    if (options.updateUserError)
      return { data: null, error: options.updateUserError }
    emit('USER_UPDATED')
    return { data: { user: fictionalSession.user }, error: null }
  })

  const rpc = vi.fn(async (name: string) => {
    if (options.networkFailure || options.rpcNetworkFailure)
      throw new Error('Failed to fetch')
    if (name === 'current_app_user_id') {
      if (options.currentAppUserIdError) {
        return { data: null, error: options.currentAppUserIdError }
      }
      return {
        data:
          options.currentAppUserId === undefined
            ? FICTIONAL_APP_USER_ID
            : options.currentAppUserId,
        error: null,
      }
    }
    return { data: null, error: null }
  })

  const from = vi.fn((table: 'app_users' | 'profiles') =>
    tableQuery(options, table),
  )

  const client = {
    auth: {
      getSession,
      signInWithPassword,
      signOut,
      resetPasswordForEmail,
      updateUser,
      onAuthStateChange: vi.fn((listener: (event: AuthEventName) => void) => {
        authEventListeners.push(listener)
        return {
          data: { subscription: { unsubscribe: vi.fn() } },
        }
      }),
    },
    rpc,
    from,
  } as unknown as SupabaseClient<Database>

  return {
    client,
    emitAuthEvent: emit,
    authEventListeners,
    signInWithPassword,
    signOut,
    resetPasswordForEmail,
    updateUser,
    rpc,
    from,
    getSession,
  }
}
