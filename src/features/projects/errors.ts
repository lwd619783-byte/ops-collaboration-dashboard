export type ProjectErrorCode =
  | 'configuration_unavailable'
  | 'network_unavailable'
  | 'authentication_required'
  | 'permission_denied'
  | 'not_found_or_forbidden'
  | 'validation_failed'
  | 'invalid_transition'
  | 'concurrent_update'
  | 'duplicate_submission'
  | 'project_archived'
  | 'unknown_service_error'

export type SafeProjectError = {
  code: ProjectErrorCode
  message: string
}

const messages: Record<ProjectErrorCode, string> = {
  configuration_unavailable: '项目服务尚未完成配置。',
  network_unavailable: '网络暂时不可用，请检查连接后重试。',
  authentication_required: '登录状态已失效，请重新登录。',
  permission_denied: '你没有执行此项目操作的权限。',
  not_found_or_forbidden: '项目不存在或你无权访问。',
  validation_failed: '项目信息不完整或格式不正确。',
  invalid_transition: '当前项目状态不允许执行此状态变更。',
  concurrent_update: '项目已被其他人修改，请刷新后重试。',
  duplicate_submission: '本次提交与先前请求冲突，请检查后重新提交。',
  project_archived: '已归档项目不能继续编辑。',
  unknown_service_error: '项目操作暂时无法完成，请稍后重试。',
}

export function createSafeProjectError(
  code: ProjectErrorCode,
): SafeProjectError {
  return { code, message: messages[code] }
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || !(key in value)) return null
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : null
}

function isNetworkMessage(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('fetch') ||
    normalized.includes('network') ||
    normalized.includes('timeout') ||
    normalized.includes('load failed')
  )
}

export function mapProjectError(error: unknown): SafeProjectError {
  const stableCode = stringField(error, 'message') ?? stringField(error, 'code')
  switch (stableCode) {
    case 'authorization_required':
    case 'bad_jwt':
    case 'jwt_expired':
      return createSafeProjectError('authentication_required')
    case 'project_permission_denied':
      return createSafeProjectError('permission_denied')
    case 'project_not_found_or_forbidden':
      return createSafeProjectError('not_found_or_forbidden')
    case 'project_validation_failed':
      return createSafeProjectError('validation_failed')
    case 'project_invalid_transition':
    case 'project_archive_requires_completed':
      return createSafeProjectError('invalid_transition')
    case 'project_concurrent_update':
      return createSafeProjectError('concurrent_update')
    case 'project_idempotency_conflict':
      return createSafeProjectError('duplicate_submission')
    case 'project_archived':
      return createSafeProjectError('project_archived')
    default: {
      const message = stringField(error, 'message')
      return createSafeProjectError(
        message && isNetworkMessage(message)
          ? 'network_unavailable'
          : 'unknown_service_error',
      )
    }
  }
}
