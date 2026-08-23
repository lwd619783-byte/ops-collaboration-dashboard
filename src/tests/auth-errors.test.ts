import { describe, expect, it } from 'vitest'
import {
  mapAuthError,
  mapInviteAuthError,
  SAFE_ERROR_MESSAGES,
  createSafeAuthError,
  isRecoveryLinkError,
} from '@/features/auth/errors'

function authError(code: string, message: string) {
  return { code, message, name: 'AuthApiError', status: 400 }
}

describe('认证错误安全映射', () => {
  it('无效凭据映射为统一安全文案', () => {
    const result = mapAuthError(
      authError('invalid_credentials', 'Invalid login credentials'),
    )
    expect(result.code).toBe('invalid_credentials')
    expect(result.message).toBe(SAFE_ERROR_MESSAGES.invalid_credentials)
    expect(result.message).not.toContain('Invalid login')
  })

  it('邮箱未确认映射为安全文案', () => {
    const result = mapAuthError(
      authError('email_not_confirmed', 'Email not confirmed'),
    )
    expect(result.code).toBe('email_not_confirmed')
    expect(result.message).not.toContain('Email')
  })

  it('频率限制映射为安全文案', () => {
    const result = mapAuthError(
      authError('over_request_rate_limit', 'Request rate limit reached'),
    )
    expect(result.code).toBe('rate_limited')
    expect(result.message).not.toContain('rate')
  })

  it('弱密码映射为安全文案', () => {
    const result = mapAuthError(
      authError('weak_password', 'Password should be at least 6 characters'),
    )
    expect(result.code).toBe('password_too_weak')
    expect(result.message).not.toContain('characters')
  })

  it('otp_expired 不过度断言为自然过期，而映射为通用失效文案', () => {
    const result = mapAuthError(
      authError('otp_expired', 'Token has expired or is invalid'),
    )
    expect(result.code).toBe('recovery_link_invalid')
    expect(result.message).toBe(SAFE_ERROR_MESSAGES.recovery_link_invalid)
    expect(result.message).toContain('可能已过期')
  })

  it('invite OTP 失效使用邀请专用文案，不误报为密码重置链接', () => {
    const result = mapInviteAuthError(
      authError('otp_expired', 'Token has expired or is invalid'),
    )
    expect(result.code).toBe('invite_link_invalid')
    expect(result.message).toBe(SAFE_ERROR_MESSAGES.invite_link_invalid)
    expect(result.message).toContain('邀请链接')
    expect(result.message).not.toContain('重置')
  })

  it('invite OTP 网络失败仍使用统一网络安全文案', () => {
    const result = mapInviteAuthError(new TypeError('Failed to fetch'))
    expect(result.code).toBe('network_unavailable')
    expect(result.message).toBe(SAFE_ERROR_MESSAGES.network_unavailable)
    expect(result.message).not.toContain('Failed to fetch')
  })

  it('显式 recovery_link_expired 仍保留确定过期语义', () => {
    const result = mapAuthError(
      authError('recovery_link_expired', 'internal detail'),
    )
    expect(result.code).toBe('recovery_link_expired')
    expect(result.message).toBe(SAFE_ERROR_MESSAGES.recovery_link_expired)
    expect(result.message).not.toContain('internal detail')
  })

  it('recovery 链接已使用映射为安全失效文案', () => {
    const result = mapAuthError(
      authError('refresh_token_already_used', 'refresh_token already used'),
    )
    expect(result.code).toBe('recovery_link_invalid')
    expect(result.message).toBe(SAFE_ERROR_MESSAGES.recovery_link_invalid)
  })

  it('缺少 recovery context 使用独立安全文案', () => {
    const result = createSafeAuthError('recovery_context_missing')
    expect(result.message).toBe(SAFE_ERROR_MESSAGES.recovery_context_missing)
    expect(result.message).toContain('没有有效的密码恢复会话')
  })

  it('网络失败映射为网络不可用', () => {
    const result = mapAuthError(new TypeError('Failed to fetch'))
    expect(result.code).toBe('network_unavailable')
    expect(result.message).toBe(SAFE_ERROR_MESSAGES.network_unavailable)
  })

  it('未知错误对象不泄露原始消息', () => {
    const result = mapAuthError({
      message: 'secret internal sql error',
      code: 'zzz_unknown',
    })
    expect(result.code).toBe('unknown')
    expect(result.message).toBe(SAFE_ERROR_MESSAGES.unknown)
    expect(result.message).not.toContain('secret')
    expect(result.message).not.toContain('sql')
  })

  it('null / undefined 映射为未知错误', () => {
    expect(mapAuthError(null).code).toBe('unknown')
    expect(mapAuthError(undefined).code).toBe('unknown')
  })

  it('createSafeAuthError 固定文案可复用', () => {
    expect(createSafeAuthError('identity_unavailable').message).toBe(
      '该账号尚未激活或暂不可使用，请联系系统管理员。',
    )
  })

  it('isRecoveryLinkError 识别恢复链接相关 code', () => {
    expect(isRecoveryLinkError('recovery_link_invalid')).toBe(true)
    expect(isRecoveryLinkError('recovery_link_expired')).toBe(true)
    expect(isRecoveryLinkError('otp_expired')).toBe(true)
    expect(isRecoveryLinkError('invalid_otp')).toBe(true)
    expect(isRecoveryLinkError('refresh_token_already_used')).toBe(true)
    expect(isRecoveryLinkError('invalid_credentials')).toBe(false)
  })
})
