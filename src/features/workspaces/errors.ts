export type WorkspaceErrorCode =
  | 'configuration_unavailable'
  | 'network_unavailable'
  | 'permission_denied'
  | 'invitation_conflict'
  | 'invitation_expired'
  | 'invitation_unavailable'
  | 'member_not_found'
  | 'member_status_conflict'
  | 'activation_recovery_unavailable'
  | 'invalid_request'
  | 'temporary_failure'

export type SafeWorkspaceError = {
  code: WorkspaceErrorCode
  message: string
}

const messages: Record<WorkspaceErrorCode, string> = {
  configuration_unavailable: '工作空间服务尚未完成配置。',
  network_unavailable: '网络暂时不可用，请检查连接后重试。',
  permission_denied: '你没有执行此操作的权限。',
  invitation_conflict: '该邀请已存在或请求已发生冲突。',
  invitation_expired: '该邀请已过期，请联系管理员重新邀请。',
  invitation_unavailable: '该邀请不可用、已处理或不属于当前账号。',
  member_not_found: '未找到该工作空间成员。',
  member_status_conflict: '成员当前状态不允许执行此操作。',
  activation_recovery_unavailable:
    '该成员当前不满足安全恢复条件，请核对其认证与邀请状态。',
  invalid_request: '提交的信息不完整或格式不正确。',
  temporary_failure: '操作暂时无法完成，请稍后重试。',
}

export function createSafeWorkspaceError(
  code: WorkspaceErrorCode,
): SafeWorkspaceError {
  return { code, message: messages[code] }
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || !(key in value)) return null
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : null
}

function isNetworkMessage(message: string): boolean {
  const value = message.toLowerCase()
  return (
    value.includes('fetch') ||
    value.includes('network') ||
    value.includes('timeout') ||
    value.includes('load failed')
  )
}

export function mapWorkspaceError(error: unknown): SafeWorkspaceError {
  const stableCode = stringField(error, 'message') ?? stringField(error, 'code')
  switch (stableCode) {
    case 'workspace_permission_denied':
    case 'workspace_owner_immutable':
      return createSafeWorkspaceError('permission_denied')
    case 'workspace_invitation_conflict':
    case 'workspace_invitation_idempotency_conflict':
    case 'invitation_conflict':
      return createSafeWorkspaceError('invitation_conflict')
    case 'workspace_invitation_expired':
    case 'invitation_expired':
      return createSafeWorkspaceError('invitation_expired')
    case 'workspace_invitation_not_owned':
    case 'workspace_invitation_unavailable':
    case 'invitation_failed':
      return createSafeWorkspaceError('invitation_unavailable')
    case 'workspace_member_not_found':
      return createSafeWorkspaceError('member_not_found')
    case 'workspace_member_status_conflict':
      return createSafeWorkspaceError('member_status_conflict')
    case 'workspace_activation_recovery_unavailable':
      return createSafeWorkspaceError('activation_recovery_unavailable')
    case 'workspace_invitation_invalid':
    case 'invalid_request':
      return createSafeWorkspaceError('invalid_request')
    case 'authorization_required':
    case 'permission_denied':
      return createSafeWorkspaceError('permission_denied')
    case 'temporary_failure':
      return createSafeWorkspaceError('temporary_failure')
    default: {
      const message = stringField(error, 'message')
      return createSafeWorkspaceError(
        message && isNetworkMessage(message)
          ? 'network_unavailable'
          : 'temporary_failure',
      )
    }
  }
}

export function isSafeWorkspaceErrorPayload(
  value: unknown,
): value is { error: { code: string } } {
  if (!value || typeof value !== 'object' || !('error' in value)) return false
  const error = (value as { error?: unknown }).error
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string',
  )
}
