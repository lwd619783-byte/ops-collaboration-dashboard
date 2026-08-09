export type TaskErrorCode =
  | 'configuration_unavailable'
  | 'network_unavailable'
  | 'authentication_required'
  | 'not_found_or_forbidden'
  | 'permission_denied'
  | 'validation_failed'
  | 'project_archived'
  | 'module_invalid'
  | 'member_invalid'
  | 'relationship_invalid'
  | 'concurrent_update'
  | 'duplicate_submission'
  | 'unknown_service_error'

export type SafeTaskError = { code: TaskErrorCode; message: string }

const messages: Record<TaskErrorCode, string> = {
  configuration_unavailable: '任务服务尚未完成配置。',
  network_unavailable: '网络暂时不可用，请检查连接后重试。',
  authentication_required: '登录状态已失效，请重新登录。',
  not_found_or_forbidden: '任务不存在或你无权访问。',
  permission_denied: '你没有执行此任务操作的权限。',
  validation_failed: '任务信息不完整或格式不正确。',
  project_archived: '已归档项目不能创建或编辑任务。',
  module_invalid: '所选模块不存在、已删除或不属于当前项目。',
  member_invalid: '只能选择当前项目内已启用且角色合适的成员。',
  relationship_invalid: '任务人员关系重复或相互冲突。',
  concurrent_update: '任务已被其他人修改，请刷新后重试。',
  duplicate_submission: '本次创建与先前请求冲突，请检查后重新提交。',
  unknown_service_error: '任务操作暂时无法完成，请稍后重试。',
}

export function createSafeTaskError(code: TaskErrorCode): SafeTaskError {
  return { code, message: messages[code] }
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || !(key in value)) return null
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : null
}

function knownCode(signal: string | null): TaskErrorCode | null {
  switch (signal) {
    case 'pgrst301':
    case 'pgrst302':
    case 'pgrst303':
    case 'bad_jwt':
    case 'jwt_expired':
    case 'invalid_jwt':
      return 'authentication_required'
    case 'task_not_found_or_forbidden':
      return 'not_found_or_forbidden'
    case '42501':
      return 'permission_denied'
    case 'task_validation_failed':
      return 'validation_failed'
    case 'task_project_archived':
    case 'task_project_archived_or_invalid':
    case 'project_archived':
      return 'project_archived'
    case 'task_module_invalid':
    case 'project_module_not_found_or_forbidden':
      return 'module_invalid'
    case 'task_member_invalid':
      return 'member_invalid'
    case 'task_relationship_duplicate':
    case 'task_assignee_collaborator_conflict':
    case 'task_visibility_users_not_allowed':
      return 'relationship_invalid'
    case 'task_concurrent_update':
    case '40001':
      return 'concurrent_update'
    case 'task_idempotency_conflict':
      return 'duplicate_submission'
    default:
      return null
  }
}

function authenticationMessage(message: string | null): boolean {
  if (!message) return false
  return /\b(jwt|bearer token|access token|session)\b.*\b(expired|invalid|missing|required)\b|not authenticated|authentication required/iu.test(
    message,
  )
}

export function mapTaskError(error: unknown): SafeTaskError {
  const code = stringField(error, 'code')?.toLowerCase() ?? null
  const message = stringField(error, 'message')?.toLowerCase() ?? null
  const business =
    code?.length === 5 && message?.startsWith('task_')
      ? knownCode(message)
      : null
  const mapped = business ?? knownCode(code) ?? knownCode(message)
  if (mapped) return createSafeTaskError(mapped)
  if (authenticationMessage(message)) {
    return createSafeTaskError('authentication_required')
  }
  if (message && /(fetch|network|timeout|load failed)/iu.test(message)) {
    return createSafeTaskError('network_unavailable')
  }
  return createSafeTaskError('unknown_service_error')
}
