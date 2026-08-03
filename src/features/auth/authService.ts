/**
 * Auth service functions: thin, testable wrappers over the Supabase client
 * that only expose safe results. Raw tokens, the full error object and any
 * internal diagnostics never leave this module. Identity resolution is done
 * exclusively through the database boundary `current_app_user_id()`.
 *
 * Every query returns an explicit `QueryResult`:
 *   - `{ ok: true, data: T }`   — the query succeeded; `data` may be null when
 *                                 the absence itself is a meaningful business
 *                                 result (e.g. no bound identity, no profile).
 *   - `{ ok: false, error }`    — the query FAILED (network / RPC / DB error).
 *                                 Callers must never confuse a failure with an
 *                                 "account unavailable" result.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables } from '@/types/database.generated'
import {
  createSafeAuthError,
  mapAuthError,
  type SafeAuthError,
} from '@/features/auth/errors'

export type AppUser = Tables<'app_users'>
export type Profile = Tables<'profiles'>

/** Storage key marking an active password-recovery session. */
export const RECOVERY_SESSION_STORAGE_KEY = 'ops-auth-recovery-session'

/**
 * Storage key for the first-activation phase. It stores only a non-sensitive
 * boolean marker ("the initial password was set for THIS activation"), never
 * a password, token or invitation link. It is bound to the current auth
 * session by the AuthProvider, which clears it on sign-out, session loss,
 * user switch, new sign-in and every other authoritative boundary.
 */
export const ACTIVATION_PHASE_STORAGE_KEY = 'ops-auth-activation-password-set'

export type AuthServiceResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: SafeAuthError }

/** Explicit query outcome; `ok: false` is a real failure, never null data. */
export type QueryResult<T> =
  { ok: true; data: T } | { ok: false; error: SafeAuthError }

/** Sign-out scope. Task 1.3 explicitly requires an explicit, reviewed scope. */
export type SignOutScope = 'local' | 'global'

/** Editable profile fields — the ONLY whitelist the browser may submit. */
export const PROFILE_EDITABLE_FIELDS = [
  'display_name',
  'organization_name',
  'title',
] as const

export type ProfileEditableInput = {
  display_name: string
  organization_name: string | null
  title: string | null
}

export const PROFILE_LENGTH_LIMITS = {
  display_name: 120,
  organization_name: 200,
  title: 200,
} as const

/** Whitelisted, trimmed profile payload (user_id/created_at/updated_at excluded). */
export function buildProfileUpdatePayload(
  input: ProfileEditableInput,
): Pick<Profile, 'display_name' | 'organization_name' | 'title'> {
  return {
    display_name: input.display_name.trim(),
    organization_name: input.organization_name?.trim() || null,
    title: input.title?.trim() || null,
  }
}

/** Client-side profile validation mirroring the database CHECK constraints. */
export function validateProfileInput(
  input: ProfileEditableInput,
): SafeAuthError | null {
  const payload = buildProfileUpdatePayload(input)

  if (payload.display_name.length === 0) {
    return {
      code: 'profile_update_failed',
      message: '显示名称不能为空。',
    }
  }
  if (payload.display_name.length > PROFILE_LENGTH_LIMITS.display_name) {
    return {
      code: 'profile_update_failed',
      message: `显示名称不能超过 ${PROFILE_LENGTH_LIMITS.display_name} 个字符。`,
    }
  }
  for (const field of ['organization_name', 'title'] as const) {
    const value = payload[field]
    if (value && value.length > PROFILE_LENGTH_LIMITS[field]) {
      return {
        code: 'profile_update_failed',
        message: `${field === 'organization_name' ? '组织名称' : '职位'}不能超过 ${PROFILE_LENGTH_LIMITS[field]} 个字符。`,
      }
    }
  }
  return null
}

/** Sign in with email + password. Identity validation happens later in the provider. */
export async function signInWithEmailAndPassword(
  client: SupabaseClient<Database>,
  email: string,
  password: string,
): Promise<AuthServiceResult> {
  try {
    const { error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) return { ok: false, error: mapAuthError(error) }
    return { ok: true, data: undefined }
  } catch (error) {
    return { ok: false, error: mapAuthError(error) }
  }
}

/**
 * Formal Supabase sign-out with an EXPLICIT scope (never the implicit default).
 * `scope: 'local'` only clears the current browser session — used for the
 * ordinary "sign out" button and for account-unavailable sign-out, because a
 * locally-revoked UI must stop showing protected content even if the remote
 * call fails. `scope: 'global'` revokes the session everywhere and is only
 * used where the product explicitly requires cross-device revocation.
 * Sign-out is best-effort: callers clear local state regardless so the UI
 * never keeps showing protected content after a failed network call.
 */
export async function signOutOfSupabase(
  client: SupabaseClient<Database>,
  scope: SignOutScope = 'local',
): Promise<void> {
  try {
    await client.auth.signOut({ scope })
  } catch {
    // Best-effort; the caller clears local state regardless.
  }
}

/** Request a password reset email with a controlled in-app redirect. */
export async function requestPasswordResetEmail(
  client: SupabaseClient<Database>,
  email: string,
  redirectTo: string,
): Promise<AuthServiceResult> {
  try {
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    })
    if (error) return { ok: false, error: mapAuthError(error) }
    return { ok: true, data: undefined }
  } catch (error) {
    return { ok: false, error: mapAuthError(error) }
  }
}

/** Update the password inside a valid recovery session. */
export async function updateUserPassword(
  client: SupabaseClient<Database>,
  password: string,
): Promise<AuthServiceResult> {
  try {
    const { error } = await client.auth.updateUser({ password })
    if (error) return { ok: false, error: mapAuthError(error) }
    return { ok: true, data: undefined }
  } catch (error) {
    return { ok: false, error: mapAuthError(error) }
  }
}

/**
 * Resolve the current internal app user id through the database boundary.
 * - `{ ok: true, data: null }`  → query succeeded but there is NO usable
 *   internal identity (unbound / unverified / revoked / invited / suspended /
 *   merged). This is the ONLY valid signal for "account unavailable".
 * - `{ ok: false, error }`      → RPC or network failure; must NOT be reported
 *   as account disabled and must NOT trigger a permanent sign-out.
 */
export async function fetchCurrentAppUserId(
  client: SupabaseClient<Database>,
): Promise<QueryResult<string | null>> {
  try {
    const { data, error } = await client.rpc('current_app_user_id')
    if (error) return { ok: false, error: mapAuthError(error) }
    const appUserId = typeof data === 'string' && data.length > 0 ? data : null
    return { ok: true, data: appUserId }
  } catch (error) {
    return { ok: false, error: mapAuthError(error) }
  }
}

/**
 * Read the caller's own app_users row (RLS: id = current_app_user_id()).
 * `ok: true, data: null` means the query succeeded but the caller has no own
 * row — a data-integrity or identity state to handle as unavailable. A failed
 * query is `ok: false` with a safe temporary error.
 */
export async function fetchOwnAppUser(
  client: SupabaseClient<Database>,
  appUserId: string,
): Promise<QueryResult<AppUser | null>> {
  try {
    const { data, error } = await client
      .from('app_users')
      .select('*')
      .eq('id', appUserId)
      .maybeSingle()
    if (error) return { ok: false, error: mapAuthError(error) }
    return { ok: true, data: data ?? null }
  } catch (error) {
    return { ok: false, error: mapAuthError(error) }
  }
}

/**
 * Read the caller's own profile row (RLS: user_id = current_app_user_id()).
 * `ok: true, data: null` means the row does not exist (profile missing);
 * a failed read is `ok: false` with `profile_read_failed` / network error.
 */
export async function fetchOwnProfile(
  client: SupabaseClient<Database>,
  appUserId: string,
): Promise<QueryResult<Profile | null>> {
  try {
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('user_id', appUserId)
      .maybeSingle()
    if (error) {
      return {
        ok: false,
        error: createSafeAuthError('profile_read_failed'),
      }
    }
    return { ok: true, data: data ?? null }
  } catch {
    return { ok: false, error: createSafeAuthError('profile_read_failed') }
  }
}

/**
 * Update the caller's own profile with the whitelisted fields only.
 * RLS (profiles_update_own) remains the final authorization boundary: even if
 * the client knew another user's id it could not modify their row.
 */
export async function updateOwnProfile(
  client: SupabaseClient<Database>,
  appUserId: string,
  input: ProfileEditableInput,
): Promise<AuthServiceResult<Profile>> {
  const validationError = validateProfileInput(input)
  if (validationError) return { ok: false, error: validationError }

  const payload = buildProfileUpdatePayload(input)
  try {
    const { data, error } = await client
      .from('profiles')
      .update(payload)
      .eq('user_id', appUserId)
      .select('*')
      .maybeSingle()
    if (error) {
      return {
        ok: false,
        error: createSafeAuthError('profile_update_failed'),
      }
    }
    if (!data) {
      return {
        ok: false,
        error: createSafeAuthError('profile_update_failed'),
      }
    }
    return { ok: true, data }
  } catch {
    return { ok: false, error: createSafeAuthError('profile_update_failed') }
  }
}
