/**
 * Safe, user-facing auth error mapping.
 *
 * Pages MUST never render raw Supabase error messages, codes, SQL, RLS
 * details, tokens or stack traces. Every failure path is reduced to a
 * stable `AuthErrorCode` plus a fixed, generic Chinese message so that the UI
 * can neither leak account-enumeration details nor internal diagnostics.
 */

import type { AuthError } from '@supabase/supabase-js'

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'rate_limited'
  | 'network_unavailable'
  | 'session_expired'
  | 'refresh_token_invalid'
  | 'recovery_context_missing'
  | 'recovery_link_invalid'
  | 'recovery_link_expired'
  | 'password_too_weak'
  | 'identity_unavailable'
  | 'profile_read_failed'
  | 'profile_update_failed'
  | 'supabase_unconfigured'
  | 'supabase_config_invalid'
  | 'unknown'

export type SafeAuthError = {
  code: AuthErrorCode
  message: string
}

export const SAFE_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: '邮箱或密码不正确，请重新输入。',
  email_not_confirmed: '该邮箱尚未完成验证，请先完成邮箱验证。',
  rate_limited: '操作过于频繁，请稍后重试。',
  network_unavailable: '网络连接不可用，请检查网络后重试。',
  session_expired: '登录状态已过期，请重新登录。',
  refresh_token_invalid: '登录状态已失效，请重新登录。',
  recovery_context_missing:
    '当前浏览器没有有效的密码恢复会话，请从最新一封密码重置邮件重新进入。',
  recovery_link_invalid:
    '此重置链接已失效，可能已过期、已使用或不是最新一封邮件中的链接，请重新申请。',
  recovery_link_expired: '此重置链接已过期，请重新申请。',
  password_too_weak: '密码不符合最低强度要求，请重新设置。',
  identity_unavailable: '该账号尚未激活或暂不可使用，请联系系统管理员。',
  profile_read_failed: '无法读取个人资料，请稍后重试。',
  profile_update_failed: '无法保存个人资料，请稍后重试。',
  supabase_unconfigured: '服务尚未完成配置，暂时无法登录。',
  supabase_config_invalid: '服务配置无效，暂时无法登录。',
  unknown: '操作未能完成，请稍后重试。',
}

export function createSafeAuthError(code: AuthErrorCode): SafeAuthError {
  return { code, message: SAFE_ERROR_MESSAGES[code] }
}

/** Stable generic fallback so an unmapped error never leaks details. */
export function unknownAuthError(): SafeAuthError {
  return createSafeAuthError('unknown')
}

/** Whether the error is caused by an invalid/expired password-recovery link. */
export function isRecoveryLinkError(code: string | undefined): boolean {
  return (
    code === 'recovery_link_invalid' ||
    code === 'recovery_link_expired' ||
    code === 'otp_expired' ||
    code === 'invalid_otp' ||
    code === 'refresh_token_not_found' ||
    code === 'refresh_token_already_used'
  )
}

type MappedAuthError = { code: AuthErrorCode; message: string }

function mapByCode(code: string): MappedAuthError | undefined {
  switch (code) {
    case 'invalid_credentials':
    case 'email_exists':
    case 'user_already_exists':
      return createSafeAuthError('invalid_credentials')
    case 'email_not_confirmed':
    case 'unverified_email':
      return createSafeAuthError('email_not_confirmed')
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
    case 'too_many_requests':
      return createSafeAuthError('rate_limited')
    case 'weak_password':
    case 'password_too_short':
      return createSafeAuthError('password_too_weak')
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
    case 'session_not_found':
    case 'bad_jwt':
      return createSafeAuthError('refresh_token_invalid')
    case 'otp_expired':
    case 'invalid_otp':
    case 'recovery_link_invalid':
      return createSafeAuthError('recovery_link_invalid')
    case 'recovery_link_expired':
      return createSafeAuthError('recovery_link_expired')
    default:
      return undefined
  }
}

function isNetworkLikeError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('fetch') ||
    normalized.includes('network') ||
    normalized.includes('timeout') ||
    normalized.includes('failed to connect') ||
    normalized.includes('load failed')
  )
}

/**
 * Map an unknown thrown value / Supabase error object to a safe auth error.
 * The raw error content is never surfaced; only the fixed message is shown.
 */
export function mapAuthError(error: unknown): SafeAuthError {
  if (error === null || error === undefined) {
    return unknownAuthError()
  }

  const code = extractErrorCode(error)
  if (code && isRecoveryLinkError(code)) {
    // Supabase can report OTP verification failures using a combined
    // invalid/expired class. Do not over-claim that `otp_expired` proves a
    // naturally elapsed TTL: the same user-facing class can also cover a used
    // or superseded one-time recovery credential.
    return createSafeAuthError(
      code === 'recovery_link_expired'
        ? 'recovery_link_expired'
        : 'recovery_link_invalid',
    )
  }
  if (code) {
    const mapped = mapByCode(code)
    if (mapped) return mapped
  }

  const message = extractErrorMessage(error)
  if (message && isNetworkLikeError(message)) {
    return createSafeAuthError('network_unavailable')
  }

  return unknownAuthError()
}

function extractErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const value = (error as { code?: unknown }).code
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function extractErrorMessage(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'message' in error) {
    const value = (error as { message?: unknown }).message
    if (typeof value === 'string' && value.length > 0) return value
  }
  if (error instanceof Error && error.message) return error.message
  return undefined
}

/** Narrowing helper so callers can treat an AuthError safely. */
export function isAuthError(error: unknown): error is AuthError {
  return (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    'name' in error
  )
}
