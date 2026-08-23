/**
 * Shared Supabase client mock for auth tests.
 *
 * The mock exposes `vi.fn()` implementations so tests can assert the REAL
 * arguments passed to signIn / signOut / resetPasswordForEmail / verifyOtp /
 * updateUser / rpc / table reads. Like the real Supabase client, sign-in emits
 * SIGNED_IN, password update emits USER_UPDATED and sign-out emits SIGNED_OUT.
 * Recovery TokenHash verification persists a session but deliberately emits no
 * PASSWORD_RECOVERY event, so tests can prove the new cross-browser recovery
 * path does not depend on the legacy PKCE callback event.
 */

import { vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.generated'

export const FICTIONAL_AUTH_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
export const FICTIONAL_APP_USER_ID = '11111111-1111-1111-1111-111111111111'
export const FICTIONAL_WORKSPACE_ID = '99999999-9999-4999-8999-999999999999'
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

export const fictionalWorkspace = {
  workspace_id: FICTIONAL_WORKSPACE_ID,
  workspace_name: 'Fictional Workspace',
  role: 'owner',
  status: 'active',
  joined_at: '2026-01-01T00:00:00+00:00',
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
  currentAppUserId?: string | null
  currentAppUserIdError?: unknown
  rpcNetworkFailure?: boolean
  appUserReadError?: unknown
  appUserRow?: typeof fictionalAppUser | null
  profileReadError?: unknown
  profileRow?: typeof fictionalProfile | null
  workspaceRows?: Array<{
    workspace_id: string
    workspace_name: string
    role: 'owner' | 'admin' | 'member' | 'external_collaborator'
    status: 'active'
    joined_at: string
  }>
  pendingInvitationRows?: Array<{
    invitation_id: string
    workspace_id: string
    workspace_name: string
    role: 'admin' | 'member' | 'external_collaborator'
    status: 'sent'
    expires_at: string
  }>
  networkFailure?: boolean
  signInError?: unknown
  resetError?: unknown
  verifyOtpError?: unknown
  updateUserError?: unknown
  profileUpdateError?: unknown
}

export type SupabaseClientMock = {
  client: SupabaseClient<Database>
  emitAuthEvent: (event: AuthEventName) => void
  authEventListeners: Array<(event: AuthEventName) => void>
  signInWithPassword: ReturnType<typeof vi.fn>
  signOut: ReturnType<typeof vi.fn>
  resetPasswordForEmail: ReturnType<typeof vi.fn>
  verifyOtp: ReturnType<typeof vi.fn>
  updateUser: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
  from: ReturnType<typeof vi.fn>
  getSession: ReturnType<typeof vi.fn>
  functionsInvoke: ReturnType<typeof vi.fn>
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

  const verifyOtp = vi.fn(async () => {
    if (options.networkFailure) throw new Error('Failed to fetch')
    if (options.verifyOtpError) {
      return {
        data: { user: null, session: null },
        error: options.verifyOtpError,
      }
    }
    // TokenHash verification establishes/persists a session but intentionally
    // does not emit PASSWORD_RECOVERY. The app must carry recovery purpose via
    // its own marker when mounting AuthProvider on /reset-password.
    hasSessionState = true
    return {
      data: { user: fictionalSession.user, session: fictionalSession },
      error: null,
    }
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
    if (name === 'list_my_workspaces') {
      return {
        data: options.workspaceRows ?? [fictionalWorkspace],
        error: null,
      }
    }
    if (name === 'list_my_pending_workspace_invitations') {
      return { data: options.pendingInvitationRows ?? [], error: null }
    }
    if (name === 'list_workspace_members') {
      return { data: [], error: null }
    }
    return { data: null, error: null }
  })

  const from = vi.fn((table: 'app_users' | 'profiles') =>
    tableQuery(options, table),
  )

  const functionsInvoke = vi.fn(async () => ({ data: null, error: null }))

  const client = {
    auth: {
      getSession,
      signInWithPassword,
      signOut,
      resetPasswordForEmail,
      verifyOtp,
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
    functions: { invoke: functionsInvoke },
  } as unknown as SupabaseClient<Database>

  return {
    client,
    emitAuthEvent: emit,
    authEventListeners,
    signInWithPassword,
    signOut,
    resetPasswordForEmail,
    verifyOtp,
    updateUser,
    rpc,
    from,
    getSession,
    functionsInvoke,
  }
}
