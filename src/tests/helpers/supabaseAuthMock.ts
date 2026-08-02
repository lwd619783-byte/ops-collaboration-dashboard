/**
 * Shared Supabase client mock for auth tests.
 *
 * The mock exposes `vi.fn()` implementations so tests can assert the REAL
 * arguments passed to signIn / signOut / resetPasswordForEmail / updateUser /
 * rpc / table reads, and can emit auth state events through `emitAuthEvent` to
 * exercise the AuthProvider subscription. All fixtures are fictional.
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
  /** Return value of rpc('current_app_user_id') */
  currentAppUserId?: string | null
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
  /** profile row returned by update and read */
  profileRow?: typeof fictionalProfile | null
  /** app_users row returned by read */
  appUserRow?: typeof fictionalAppUser | null
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
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => {
          if (table === 'app_users') {
            return { data: options.appUserRow ?? fictionalAppUser, error: null }
          }
          return { data: options.profileRow ?? fictionalProfile, error: null }
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
            return { data: options.profileRow ?? fictionalProfile, error: null }
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
    return { data: { user: fictionalSession.user }, error: null }
  })

  const signOut = vi.fn(async () => {
    if (options.networkFailure) throw new Error('Failed to fetch')
    hasSessionState = false
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
    return { data: { user: fictionalSession.user }, error: null }
  })

  const rpc = vi.fn(async (name: string) => {
    if (name === 'current_app_user_id') {
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
    emitAuthEvent: (event) => {
      for (const listener of authEventListeners) listener(event)
    },
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
