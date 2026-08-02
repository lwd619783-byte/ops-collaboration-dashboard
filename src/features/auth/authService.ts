/**
 * Auth service functions: thin, testable wrappers over the Supabase client
 * that only expose safe results. Raw tokens, the full error object and any
 * internal diagnostics never leave this module. Identity resolution is done
 * exclusively through the database boundary `current_app_user_id()`.
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

export type AuthServiceResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: SafeAuthError }

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

/** Formal Supabase sign-out; local auth state is cleared by the caller. */
export async function signOutOfSupabase(
  client: SupabaseClient<Database>,
): Promise<void> {
  try {
    await client.auth.signOut()
  } catch {
    // Sign-out is best-effort; the caller clears local state regardless so the
    // UI never keeps showing protected content after a failed network call.
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
 * Returns null when the caller has no usable internal identity (unbound,
 * unverified, revoked, invited/suspended/merged). RLS protects the reads.
 */
export async function fetchCurrentAppUserId(
  client: SupabaseClient<Database>,
): Promise<string | null> {
  try {
    const { data, error } = await client.rpc('current_app_user_id')
    if (error) return null
    return typeof data === 'string' && data.length > 0 ? data : null
  } catch {
    return null
  }
}

/** Read the caller's own app_users row (RLS: id = current_app_user_id()). */
export async function fetchOwnAppUser(
  client: SupabaseClient<Database>,
  appUserId: string,
): Promise<AppUser | null> {
  try {
    const { data, error } = await client
      .from('app_users')
      .select('*')
      .eq('id', appUserId)
      .maybeSingle()
    if (error) return null
    return data
  } catch {
    return null
  }
}

/** Read the caller's own profile row (RLS: user_id = current_app_user_id()). */
export async function fetchOwnProfile(
  client: SupabaseClient<Database>,
  appUserId: string,
): Promise<Profile | null> {
  try {
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('user_id', appUserId)
      .maybeSingle()
    if (error) return null
    return data
  } catch {
    return null
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
