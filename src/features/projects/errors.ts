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
  | 'invalid_member_candidate'
  | 'member_role_conflict'
  | 'member_not_found'
  | 'protected_member_role'
  | 'module_validation_failed'
  | 'module_name_conflict'
  | 'module_order_invalid'
  | 'module_not_found_or_forbidden'
  | 'module_not_empty'
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
  invalid_member_candidate: '只能选择当前工作空间内已启用的用户。',
  member_role_conflict: '该成员已有受保护或冲突的项目角色。',
  member_not_found: '该项目成员不存在或已被移除。',
  protected_member_role: '负责人和牵头人须通过专用操作调整。',
  module_validation_failed: '模块名称不完整或格式不正确。',
  module_name_conflict: '当前项目中已存在同名模块。',
  module_order_invalid: '模块顺序已变化，请刷新后重试。',
  module_not_found_or_forbidden: '模块不存在或你无权访问。',
  module_not_empty: '该模块已有任务，不能删除。',
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

function isAuthenticationMessage(message: string | null): boolean {
  if (!message) return false
  const normalized = message.toLowerCase()
  return (
    // JWT expired / invalid JWT
    /\bjwt\b/.test(normalized) ||
    /json web token/.test(normalized) ||
    // Bearer token missing / invalid / required
    /bearer token (?:missing|invalid|required|expired)/.test(normalized) ||
    // access token expired / invalid / missing / required
    /access token (?:expired|invalid|missing|required)/.test(normalized) ||
    /not authenticated/.test(normalized) ||
    /authentication required/.test(normalized) ||
    /session (?:has )?expired/.test(normalized) ||
    /unauthorized/.test(normalized) ||
    /login (?:required|expired|invalid)/.test(normalized)
  )
}

function mapKnownCode(signal: string | null): ProjectErrorCode | null {
  // `signal` is already normalized to lower-case by the caller. PostgreSQL
  // SQLSTATE values (e.g. `42501`) and project custom codes are case-stable,
  // so lower-casing never alters their meaning.
  switch (signal) {
    // Supabase / PostgREST authentication failures.
    case 'pgrst301':
    case 'pgrst302':
    case 'pgrst303':
    case 'authorization_required':
    case 'bad_jwt':
    case 'jwt_expired':
    case 'invalid_jwt':
    case 'invalid_token':
    case 'unauthorized':
      return 'authentication_required'
    // Ordinary permission denial stays a permission error, never a login error.
    case '42501':
    case 'project_permission_denied':
      return 'permission_denied'
    case 'project_not_found_or_forbidden':
      return 'not_found_or_forbidden'
    case 'project_validation_failed':
      return 'validation_failed'
    case 'project_invalid_transition':
    case 'project_archive_requires_completed':
      return 'invalid_transition'
    case 'project_concurrent_update':
    case '40001':
      return 'concurrent_update'
    case 'project_idempotency_conflict':
      return 'duplicate_submission'
    case 'project_archived':
      return 'project_archived'
    case 'project_member_candidate_invalid':
      return 'invalid_member_candidate'
    case 'project_member_role_conflict':
    case 'project_owner_lead_conflict':
      return 'member_role_conflict'
    case 'project_member_not_found':
      return 'member_not_found'
    case 'project_member_role_protected':
      return 'protected_member_role'
    case 'project_module_validation_failed':
      return 'module_validation_failed'
    case 'project_module_name_conflict':
      return 'module_name_conflict'
    case 'project_module_order_invalid':
      return 'module_order_invalid'
    case 'project_module_not_found_or_forbidden':
      return 'module_not_found_or_forbidden'
    case 'project_module_not_empty':
      return 'module_not_empty'
    case 'project_module_permission_denied':
      return 'permission_denied'
    default:
      return null
  }
}

export function mapProjectError(error: unknown): SafeProjectError {
  const code = stringField(error, 'code')
  const message = stringField(error, 'message')

  // Normalize the structured code once so stable identifiers (PGRST301/302/303,
  // JWT codes, 42501, project_* codes) match regardless of upstream casing.
  // `message` is intentionally NOT lower-cased here — it is only used as a
  // loose fallback for gateway-supplied codes and is matched verbatim.
  const normalizedCode = code ? code.toLowerCase() : null

  // The structured error code is authoritative. A descriptive message must
  // never shadow an explicit code, and the code must be inspected even when a
  // message is also present.
  const mapped = mapKnownCode(normalizedCode) ?? mapKnownCode(message)
  if (mapped) return createSafeProjectError(mapped)

  // Some gateways surface authentication failures only through the message.
  // JWT/token wording is matched here, but an ordinary permission denial stays
  // mapped as a permission error, never as a login failure.
  if (isAuthenticationMessage(message)) {
    return createSafeProjectError('authentication_required')
  }

  return createSafeProjectError(
    message && isNetworkMessage(message)
      ? 'network_unavailable'
      : 'unknown_service_error',
  )
}
