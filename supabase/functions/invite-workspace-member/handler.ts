export type InvitationRole = 'admin' | 'member' | 'external_collaborator'

export type InvitationStatus =
  'prepared' | 'reissue_prepared' | 'sent' | 'accepted' | 'failed' | 'revoked'

export type InvitationOperationKind =
  'new_auth_user_invite' | 'existing_invitee_reissue'

export type PreparationInput = {
  workspaceId: string
  emailHash: string
  emailHint: string
  displayName: string
  role: InvitationRole
  idempotencyKey: string
}

export type PreparedInvitation = {
  invitationId: string
  status: InvitationStatus
  shouldSend: boolean
  operationKind: InvitationOperationKind
}

export type AuthInviteInput = {
  email: string
  redirectTo: string
  invitationId: string
  providerTenant: string
}

/**
 * Successful Auth Admin invite result. The returned Auth user ID is REQUIRED
 * for the reissue path: finalize verifies it against the invitee identity in
 * the database. It is never returned to the browser or written to logs.
 */
export type AuthInviteResult = {
  authUserId: string
}

export type FailureCategory =
  'auth_invite_failed' | 'auth_user_conflict' | 'temporary_failure'

export type EdgeOperationResult<T> =
  { ok: true; data: T } | { ok: false; code: string }

export type InviteWorkspaceMemberDependencies = {
  allowedOrigins: ReadonlySet<string>
  /**
   * Invitation expiry is computed only by the trusted database boundary
   * (workspace_invitation_ttl_seconds()); this handler never receives or
   * computes an expiry, so browsers can never influence it.
   */
  authenticate: (
    authorization: string,
  ) => Promise<EdgeOperationResult<{ providerTenant: string }>>
  prepareInvitation: (
    input: PreparationInput,
    authorization: string,
  ) => Promise<EdgeOperationResult<PreparedInvitation>>
  inviteAuthUser: (
    input: AuthInviteInput,
  ) => Promise<EdgeOperationResult<AuthInviteResult>>
  /**
   * Service-only confirmation boundary. After Auth Admin accepted the request,
   * EVERY operation kind must be confirmed against the database before the
   * handler may report success:
   *   - existing_invitee_reissue: full identity verification, reissue -> sent;
   *   - new_auth_user_invite: the AFTER INSERT trigger must have provisioned
   *     identity + membership and moved the invitation to sent; otherwise the
   *     invitation is compensated to failed/auth_user_conflict ('failed').
   * A confirmed 'failed' status must NOT be re-compensated by the handler.
   */
  confirmInvitation: (
    input: ConfirmInvitationInput,
  ) => Promise<EdgeOperationResult<{ status: 'sent' | 'failed' }>>
  markInvitationFailed: (
    invitationId: string,
    failureCategory: FailureCategory,
  ) => Promise<EdgeOperationResult<undefined>>
}

export type ConfirmInvitationInput = {
  invitationId: string
  operationKind: InvitationOperationKind
  providerTenant: string
  authUserId: string
}

type SafeErrorDefinition = {
  status: number
  message: string
}

const safeErrors = {
  method_not_allowed: {
    status: 405,
    message: '请求方法不受支持。',
  },
  origin_not_allowed: {
    status: 403,
    message: '当前页面来源不受信任。',
  },
  authorization_required: {
    status: 401,
    message: '登录状态无效，请重新登录。',
  },
  invalid_request: {
    status: 400,
    message: '邀请信息不完整或格式不正确。',
  },
  permission_denied: {
    status: 403,
    message: '你没有邀请该成员的权限。',
  },
  invitation_conflict: {
    status: 409,
    message: '该邀请已存在或请求已发生冲突。',
  },
  invitation_failed: {
    status: 409,
    message: '该邀请已结束，请重新发起邀请。',
  },
  temporary_failure: {
    status: 503,
    message: '邀请暂时无法发送，请稍后重试。',
  },
} satisfies Record<string, SafeErrorDefinition>

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const maxBodyBytes = 8192

function responseHeaders(origin?: string): Headers {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set(
      'Access-Control-Allow-Headers',
      'authorization, apikey, content-type',
    )
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    headers.set('Access-Control-Max-Age', '600')
    headers.set('Vary', 'Origin')
  }
  return headers
}

function safeError(code: keyof typeof safeErrors, origin?: string): Response {
  const definition = safeErrors[code]
  return new Response(
    JSON.stringify({ ok: false, error: { code, message: definition.message } }),
    { status: definition.status, headers: responseHeaders(origin) },
  )
}

function success(
  code: 'invitation_sent' | 'invitation_already_processed',
  origin: string,
): Response {
  const message =
    code === 'invitation_sent'
      ? '邀请已发送。'
      : '该邀请请求已处理，无需重复发送。'
  return new Response(JSON.stringify({ ok: true, data: { code, message } }), {
    status: 200,
    headers: responseHeaders(origin),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (
    normalized.length < 3 ||
    normalized.length > 254 ||
    !emailPattern.test(normalized)
  ) {
    return null
  }
  const [localPart, domain, ...extra] = normalized.split('@')
  if (
    extra.length > 0 ||
    !localPart ||
    !domain ||
    localPart.length > 64 ||
    domain.length > 253
  ) {
    return null
  }
  return normalized
}

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 120) return null
  return normalized
}

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== 'string' || !uuidPattern.test(value)) return null
  return value.toLowerCase()
}

function normalizeRole(value: unknown): InvitationRole | null {
  if (
    value === 'admin' ||
    value === 'member' ||
    value === 'external_collaborator'
  ) {
    return value
  }
  return null
}

async function hashEmail(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function maskEmail(email: string): string {
  const separator = email.lastIndexOf('@')
  const localPart = email.slice(0, separator)
  const domain = email.slice(separator + 1)
  const domainParts = domain.split('.')
  const domainName = domainParts.shift() ?? ''
  const suffix = domainParts.length > 0 ? `.${domainParts.join('.')}` : ''
  return `${localPart.slice(0, 1)}***@${domainName.slice(0, 1)}***${suffix}`
}

function mapPreparationError(code: string): keyof typeof safeErrors {
  if (code === 'workspace_permission_denied') return 'permission_denied'
  if (
    code === 'workspace_invitation_conflict' ||
    code === 'workspace_invitation_idempotency_conflict' ||
    code === 'workspace_invitation_role_conflict' ||
    code === 'workspace_invitation_auth_user_conflict'
  ) {
    return 'invitation_conflict'
  }
  if (code === 'workspace_invitation_invalid') return 'invalid_request'
  return 'temporary_failure'
}

function mapInviteFailure(code: string): FailureCategory {
  if (
    code === 'user_already_exists' ||
    code === 'email_exists' ||
    code === 'identity_already_exists'
  ) {
    return 'auth_user_conflict'
  }
  return 'auth_invite_failed'
}

function getBearerAuthorization(request: Request): string | null {
  const value = request.headers.get('Authorization')
  if (!value || !/^Bearer\s+\S+$/i.test(value)) return null
  return value
}

async function parseRequestBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get('Content-Length')
  if (contentLength) {
    const parsed = Number(contentLength)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > maxBodyBytes) {
      throw new Error('invalid_request')
    }
  }
  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > maxBodyBytes) {
    throw new Error('invalid_request')
  }
  return JSON.parse(rawBody) as unknown
}

export function createInviteWorkspaceMemberHandler(
  dependencies: InviteWorkspaceMemberDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('Origin') ?? ''
    if (!dependencies.allowedOrigins.has(origin)) {
      return safeError('origin_not_allowed')
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: responseHeaders(origin),
      })
    }
    if (request.method !== 'POST') {
      return safeError('method_not_allowed', origin)
    }

    const authorization = getBearerAuthorization(request)
    if (!authorization) {
      return safeError('authorization_required', origin)
    }

    let authentication: EdgeOperationResult<{ providerTenant: string }>
    try {
      authentication = await dependencies.authenticate(authorization)
    } catch {
      return safeError('temporary_failure', origin)
    }
    if (!authentication.ok) {
      return safeError(
        authentication.code === 'temporary_failure'
          ? 'temporary_failure'
          : 'authorization_required',
        origin,
      )
    }

    let body: unknown
    try {
      body = await parseRequestBody(request)
    } catch {
      return safeError('invalid_request', origin)
    }
    if (!isRecord(body)) return safeError('invalid_request', origin)

    const workspaceId = normalizeUuid(body.workspaceId)
    const idempotencyKey = normalizeUuid(body.idempotencyKey)
    const email = normalizeEmail(body.email)
    const displayName = normalizeDisplayName(body.displayName)
    const role = normalizeRole(body.role)
    if (!workspaceId || !idempotencyKey || !email || !displayName || !role) {
      return safeError('invalid_request', origin)
    }

    let emailHash: string
    try {
      emailHash = await hashEmail(email)
    } catch {
      return safeError('temporary_failure', origin)
    }
    let preparation: EdgeOperationResult<PreparedInvitation>
    try {
      preparation = await dependencies.prepareInvitation(
        {
          workspaceId,
          emailHash,
          emailHint: maskEmail(email),
          displayName,
          role,
          idempotencyKey,
        },
        authorization,
      )
    } catch {
      return safeError('temporary_failure', origin)
    }
    if (!preparation.ok) {
      return safeError(mapPreparationError(preparation.code), origin)
    }

    if (!preparation.data.shouldSend) {
      if (
        preparation.data.status === 'sent' ||
        preparation.data.status === 'accepted'
      ) {
        return success('invitation_already_processed', origin)
      }
      if (preparation.data.status === 'failed') {
        return safeError('invitation_failed', origin)
      }
      return safeError('invitation_conflict', origin)
    }

    let inviteResult: EdgeOperationResult<AuthInviteResult>
    try {
      inviteResult = await dependencies.inviteAuthUser({
        email,
        redirectTo: `${origin}/activate-account`,
        invitationId: preparation.data.invitationId,
        providerTenant: authentication.data.providerTenant,
      })
    } catch {
      inviteResult = { ok: false, code: 'temporary_failure' }
    }
    if (!inviteResult.ok) {
      const failureCategory =
        inviteResult.code === 'temporary_failure'
          ? 'temporary_failure'
          : mapInviteFailure(inviteResult.code)
      let compensation: EdgeOperationResult<undefined>
      try {
        compensation = await dependencies.markInvitationFailed(
          preparation.data.invitationId,
          failureCategory,
        )
      } catch {
        return safeError('temporary_failure', origin)
      }
      if (!compensation.ok) return safeError('temporary_failure', origin)
      return safeError(
        failureCategory === 'auth_user_conflict'
          ? 'invitation_conflict'
          : 'temporary_failure',
        origin,
      )
    }

    // ---------------------------------------------------------------------
    // Unified database confirmation boundary. Auth Admin success is NOT a
    // business success: every operation kind must be confirmed against the
    // invitation state and the invitee identity before reporting sent.
    // ---------------------------------------------------------------------
    let confirmResult: EdgeOperationResult<{ status: 'sent' | 'failed' }>
    try {
      confirmResult = await dependencies.confirmInvitation({
        invitationId: preparation.data.invitationId,
        operationKind: preparation.data.operationKind,
        providerTenant: authentication.data.providerTenant,
        authUserId: inviteResult.data.authUserId,
      })
    } catch {
      confirmResult = { ok: false, code: 'temporary_failure' }
    }
    if (!confirmResult.ok) {
      // Database-level confirmation failure (e.g. transient RPC error). The
      // invitation is still in its pre-confirmation state; compensate it as a
      // recoverable temporary failure so the digest can be re-issued later.
      let compensation: EdgeOperationResult<undefined>
      try {
        compensation = await dependencies.markInvitationFailed(
          preparation.data.invitationId,
          'temporary_failure',
        )
      } catch {
        return safeError('temporary_failure', origin)
      }
      if (!compensation.ok) return safeError('temporary_failure', origin)
      return safeError('temporary_failure', origin)
    }
    if (confirmResult.data.status === 'failed') {
      // The confirmation already compensated the invitation to
      // failed/auth_user_conflict (e.g. Auth reused an existing unconfirmed
      // user). Return the stable conflict; never re-compensate, never reveal
      // why the account exists.
      return safeError('invitation_conflict', origin)
    }

    return success('invitation_sent', origin)
  }
}
