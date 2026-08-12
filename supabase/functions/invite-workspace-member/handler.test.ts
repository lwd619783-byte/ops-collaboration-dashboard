import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createInviteWorkspaceMemberHandler,
  type InviteWorkspaceMemberDependencies,
} from './handler'
import { resolveVerifiedProviderTenant } from './verified-issuer'
import {
  DEFAULT_INVITE_TTL_SECONDS,
  MAX_INVITE_TTL_SECONDS,
  MIN_INVITE_TTL_SECONDS,
  parseInviteTtlSeconds,
} from './entry'

const allowedOrigin = 'http://127.0.0.1:3000'
const workspaceId = '11111111-1111-4111-8111-111111111111'
const idempotencyKey = '22222222-2222-4222-8222-222222222222'
const invitationId = '33333333-3333-4333-8333-333333333333'
const authorization = 'Bearer fictional-user-token'

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId,
    email: 'invitee@example.invalid',
    displayName: 'Fictional Invitee',
    role: 'member',
    idempotencyKey,
    ...overrides,
  }
}

function request(
  body: unknown = validBody(),
  options: {
    method?: string
    origin?: string
    authorization?: string | null
    rawBody?: string
    accessControlRequestMethod?: string
    accessControlRequestHeaders?: string
  } = {},
) {
  const headers = new Headers({
    Origin: options.origin ?? allowedOrigin,
    'Content-Type': 'application/json',
  })
  if (options.authorization !== null) {
    headers.set('Authorization', options.authorization ?? authorization)
  }
  if (options.accessControlRequestMethod) {
    headers.set(
      'Access-Control-Request-Method',
      options.accessControlRequestMethod,
    )
  }
  if (options.accessControlRequestHeaders) {
    headers.set(
      'Access-Control-Request-Headers',
      options.accessControlRequestHeaders,
    )
  }
  return new Request(
    'http://127.0.0.1:54321/functions/v1/invite-workspace-member',
    {
      method: options.method ?? 'POST',
      headers,
      body:
        options.method === 'OPTIONS' || options.method === 'GET'
          ? undefined
          : (options.rawBody ?? JSON.stringify(body)),
    },
  )
}

function dependencies(): InviteWorkspaceMemberDependencies {
  return {
    allowedOrigins: new Set([allowedOrigin]),
    authenticate: vi.fn(async () => ({
      ok: true,
      data: { providerTenant: 'http://127.0.0.1:54321/auth/v1' },
    })),
    prepareInvitation: vi.fn(async () => ({
      ok: true,
      data: {
        invitationId,
        status: 'prepared',
        shouldSend: true,
        operationKind: 'new_auth_user_invite',
      },
    })),
    inviteAuthUser: vi.fn(async () => ({
      ok: true,
      data: { authUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    })),
    confirmInvitation: vi.fn(async () => ({
      ok: true,
      data: { status: 'sent' },
    })),
    markInvitationFailed: vi.fn(async () => ({
      ok: true,
      data: undefined,
    })),
  }
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

function commaSeparatedTokens(value: string | null): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token !== ''),
  )
}

function fictionalVerifiedToken(subject: string, issuer: string) {
  const encode = (value: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    const binary = String.fromCharCode(...bytes)
    return btoa(binary)
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  }
  return `${encode({ alg: 'none' })}.${encode({ sub: subject, iss: issuer })}.fixture`
}

describe('verified provider tenant resolution', () => {
  const subject = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

  it('accepts the exact hosted Auth issuer after official user verification', () => {
    const token = fictionalVerifiedToken(
      subject,
      'https://fictional-project.supabase.co/auth/v1',
    )
    expect(
      resolveVerifiedProviderTenant({
        token,
        verifiedUserId: subject,
        trustedSupabaseUrl: 'https://fictional-project.supabase.co',
      }),
    ).toBe('https://fictional-project.supabase.co/auth/v1')
  })

  it('accepts only a loopback issuer for the local internal Kong runtime', () => {
    const token = fictionalVerifiedToken(
      subject,
      'http://127.0.0.1:54321/auth/v1',
    )
    expect(
      resolveVerifiedProviderTenant({
        token,
        verifiedUserId: subject,
        trustedSupabaseUrl: 'http://kong:8000',
      }),
    ).toBe('http://127.0.0.1:54321/auth/v1')
  })

  it('rejects a mismatched verified subject or an unrelated issuer', () => {
    const token = fictionalVerifiedToken(
      subject,
      'https://untrusted.invalid/auth/v1',
    )
    expect(
      resolveVerifiedProviderTenant({
        token,
        verifiedUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        trustedSupabaseUrl: 'http://kong:8000',
      }),
    ).toBeNull()
    expect(
      resolveVerifiedProviderTenant({
        token,
        verifiedUserId: subject,
        trustedSupabaseUrl: 'https://fictional-project.supabase.co',
      }),
    ).toBeNull()
  })
})

describe('invite-workspace-member Edge Function handler', () => {
  let deps: InviteWorkspaceMemberDependencies

  beforeEach(() => {
    deps = dependencies()
  })

  it('returns the explicit SDK-compatible contract for a realistic preflight', async () => {
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(
      request(undefined, {
        method: 'OPTIONS',
        authorization: null,
        accessControlRequestMethod: 'POST',
        accessControlRequestHeaders:
          'authorization, apikey, content-type, x-client-info',
      }),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      allowedOrigin,
    )
    expect(
      commaSeparatedTokens(
        response.headers.get('Access-Control-Allow-Methods'),
      ),
    ).toEqual(new Set(['post', 'options']))
    expect(
      commaSeparatedTokens(
        response.headers.get('Access-Control-Allow-Headers'),
      ),
    ).toEqual(
      new Set(['authorization', 'apikey', 'content-type', 'x-client-info']),
    )
    expect(commaSeparatedTokens(response.headers.get('Vary'))).toEqual(
      new Set(['origin']),
    )
    expect(response.headers.get('Access-Control-Max-Age')).toBe('600')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(deps.authenticate).not.toHaveBeenCalled()
    expect(deps.prepareInvitation).not.toHaveBeenCalled()
    expect(deps.inviteAuthUser).not.toHaveBeenCalled()
    expect(deps.confirmInvitation).not.toHaveBeenCalled()
    expect(deps.markInvitationFailed).not.toHaveBeenCalled()
  })

  it('rejects a preflight from a disallowed origin before business handling', async () => {
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(
      request(undefined, {
        method: 'OPTIONS',
        origin: 'https://untrusted.invalid',
        authorization: null,
        accessControlRequestMethod: 'POST',
        accessControlRequestHeaders:
          'authorization, apikey, content-type, x-client-info',
      }),
    )

    expect(response.status).toBe(403)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(response.headers.get('Access-Control-Allow-Headers')).toBeNull()
    expect(deps.authenticate).not.toHaveBeenCalled()
    expect(deps.prepareInvitation).not.toHaveBeenCalled()
  })

  it('does not reflect an attacker-controlled requested header', async () => {
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(
      request(undefined, {
        method: 'OPTIONS',
        authorization: null,
        accessControlRequestMethod: 'POST',
        accessControlRequestHeaders:
          'authorization, apikey, content-type, x-client-info, x-attacker-controlled',
      }),
    )

    expect(response.status).toBe(204)
    expect(
      commaSeparatedTokens(
        response.headers.get('Access-Control-Allow-Headers'),
      ),
    ).toEqual(
      new Set(['authorization', 'apikey', 'content-type', 'x-client-info']),
    )
    expect(deps.authenticate).not.toHaveBeenCalled()
    expect(deps.prepareInvitation).not.toHaveBeenCalled()
  })

  it('rejects a non-allowed origin before processing credentials', async () => {
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(
      request(validBody(), { origin: 'https://untrusted.invalid' }),
    )

    expect(response.status).toBe(403)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(deps.authenticate).not.toHaveBeenCalled()
  })

  it('rejects unsupported methods', async () => {
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request(undefined, { method: 'GET' }))

    expect(response.status).toBe(405)
    expect(await json(response)).toEqual({
      ok: false,
      error: {
        code: 'method_not_allowed',
        message: '请求方法不受支持。',
      },
    })
  })

  it('requires a bearer Authorization header', async () => {
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(
      request(validBody(), { authorization: null }),
    )

    expect(response.status).toBe(401)
    expect(deps.authenticate).not.toHaveBeenCalled()
  })

  it('rejects a token that official authentication does not verify', async () => {
    deps.authenticate = vi.fn(async () => ({
      ok: false,
      code: 'authorization_required',
    }))
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(401)
    expect(deps.prepareInvitation).not.toHaveBeenCalled()
  })

  it('keeps an authentication network failure distinct from an invalid session', async () => {
    deps.authenticate = vi.fn(async () => ({
      ok: false,
      code: 'temporary_failure',
    }))
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(503)
    expect(deps.prepareInvitation).not.toHaveBeenCalled()
  })

  it('rejects invalid JSON without calling database preparation', async () => {
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request(undefined, { rawBody: '{' }))

    expect(response.status).toBe(400)
    expect(deps.prepareInvitation).not.toHaveBeenCalled()
  })

  it.each([
    ['email', { email: 'not-an-email' }],
    ['role', { role: 'owner' }],
    ['workspace uuid', { workspaceId: 'not-a-uuid' }],
    ['idempotency uuid', { idempotencyKey: 'not-a-uuid' }],
    ['display name', { displayName: ' '.repeat(3) }],
  ])('rejects an invalid %s', async (_label, invalid) => {
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request(validBody(invalid)))

    expect(response.status).toBe(400)
    expect(deps.prepareInvitation).not.toHaveBeenCalled()
  })

  it('passes only a digest and masked hint to the RLS-scoped preparation RPC', async () => {
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(200)
    expect(deps.prepareInvitation).toHaveBeenCalledOnce()
    expect(deps.prepareInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        emailHash:
          'edf699b8eaac2b16a4be489c88ee9867a258ed1b2a690c534758a054d3a82877',
        emailHint: 'i***@e***.invalid',
        displayName: 'Fictional Invitee',
        role: 'member',
        idempotencyKey,
      }),
      authorization,
    )
    const preparedInput = vi.mocked(deps.prepareInvitation).mock.calls[0]?.[0]
    expect(JSON.stringify(preparedInput)).not.toContain(
      'invitee@example.invalid',
    )
    // Browsers cannot influence the expiry: the handler never computes or
    // forwards one, and the database is the only expiry authority.
    expect(JSON.stringify(preparedInput)).not.toContain('expiresAt')
  })

  it('uses database authorization as the final boundary for a member caller', async () => {
    deps.prepareInvitation = vi.fn(async () => ({
      ok: false,
      code: 'workspace_permission_denied',
    }))
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(403)
    expect(deps.inviteAuthUser).not.toHaveBeenCalled()
  })

  it('rejects an admin inviting admin when the database denies the role', async () => {
    deps.prepareInvitation = vi.fn(async () => ({
      ok: false,
      code: 'workspace_permission_denied',
    }))
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request(validBody({ role: 'admin' })))

    expect(response.status).toBe(403)
    expect(deps.inviteAuthUser).not.toHaveBeenCalled()
  })

  it('allows an owner-authorized admin invitation with trusted metadata only', async () => {
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request(validBody({ role: 'admin' })))

    expect(response.status).toBe(200)
    expect(deps.inviteAuthUser).toHaveBeenCalledWith({
      email: 'invitee@example.invalid',
      redirectTo: `${allowedOrigin}/activate-account`,
      invitationId,
      providerTenant: 'http://127.0.0.1:54321/auth/v1',
    })
  })

  it('does not call Auth Admin again for an idempotently processed request', async () => {
    deps.prepareInvitation = vi.fn(async () => ({
      ok: true,
      data: { invitationId, status: 'sent', shouldSend: false },
    }))
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({
      ok: true,
      data: {
        code: 'invitation_already_processed',
        message: '该邀请请求已处理，无需重复发送。',
      },
    })
    expect(deps.inviteAuthUser).not.toHaveBeenCalled()
  })

  it('does not dispatch a second Auth invitation while the first request is still prepared', async () => {
    deps.prepareInvitation = vi.fn(async () => ({
      ok: true,
      data: { invitationId, status: 'prepared', shouldSend: false },
    }))
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(409)
    expect(deps.inviteAuthUser).not.toHaveBeenCalled()
  })

  it('maps a thrown database preparation failure to a fixed response', async () => {
    deps.prepareInvitation = vi.fn(async () => {
      throw new Error('raw database connection detail')
    })
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('raw database')
    expect(deps.inviteAuthUser).not.toHaveBeenCalled()
  })

  it('compensates a thrown Auth Admin request without exposing the exception', async () => {
    deps.inviteAuthUser = vi.fn(async () => {
      throw new Error('raw Auth provider detail')
    })
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(503)
    expect(deps.markInvitationFailed).toHaveBeenCalledWith(
      invitationId,
      'temporary_failure',
    )
    expect(await response.text()).not.toContain('raw Auth')
  })

  it('maps a thrown compensation failure to a fixed response', async () => {
    deps.inviteAuthUser = vi.fn(async () => ({
      ok: false,
      code: 'provider_failure',
    }))
    deps.markInvitationFailed = vi.fn(async () => {
      throw new Error('raw compensation detail')
    })
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('raw compensation')
  })

  it('marks a prepared invitation failed when Auth Admin fails', async () => {
    deps.inviteAuthUser = vi.fn(async () => ({
      ok: false,
      code: 'email_exists',
    }))
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(409)
    expect(deps.markInvitationFailed).toHaveBeenCalledWith(
      invitationId,
      'auth_user_conflict',
    )
  })

  it('returns a safe temporary failure when compensation cannot be recorded', async () => {
    deps.inviteAuthUser = vi.fn(async () => ({
      ok: false,
      code: 'provider_failure',
    }))
    deps.markInvitationFailed = vi.fn(async () => ({
      ok: false,
      code: 'database_unavailable',
    }))
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('database_unavailable')
  })

  it('never returns the email, token, invitation id or provider secret', async () => {
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())
    const text = await response.text()

    expect(text).not.toContain('invitee@example.invalid')
    expect(text).not.toContain('fictional-user-token')
    expect(text).not.toContain(invitationId)
    expect(text).not.toContain('secret')
  })

  it('confirms an existing-invitee reissue after Auth accepts the re-send', async () => {
    deps.prepareInvitation = vi.fn(async () => ({
      ok: true,
      data: {
        invitationId,
        status: 'reissue_prepared',
        shouldSend: true,
        operationKind: 'existing_invitee_reissue',
      },
    }))
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({
      ok: true,
      data: { code: 'invitation_sent', message: '邀请已发送。' },
    })
    // Auth Admin is called once for the re-send...
    expect(deps.inviteAuthUser).toHaveBeenCalledTimes(1)
    // ...then the unified confirmation RPC runs with the operation kind, the
    // verified issuer and the Auth Admin returned user ID.
    expect(deps.confirmInvitation).toHaveBeenCalledWith({
      invitationId,
      operationKind: 'existing_invitee_reissue',
      providerTenant: 'http://127.0.0.1:54321/auth/v1',
      authUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })
    expect(deps.markInvitationFailed).not.toHaveBeenCalled()
  })

  it('confirms a new-auth-user invite after the trigger completed', async () => {
    deps.prepareInvitation = vi.fn(async () => ({
      ok: true,
      data: {
        invitationId,
        status: 'prepared',
        shouldSend: true,
        operationKind: 'new_auth_user_invite',
      },
    }))
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(200)
    expect(deps.inviteAuthUser).toHaveBeenCalledTimes(1)
    // The new-auth-user flow MUST also pass the unified confirmation boundary
    // (trigger completed sent + identity + membership) before reporting sent.
    expect(deps.confirmInvitation).toHaveBeenCalledWith({
      invitationId,
      operationKind: 'new_auth_user_invite',
      providerTenant: 'http://127.0.0.1:54321/auth/v1',
      authUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })
  })

  it('maps a confirmed auth_user_conflict to a stable 409 without re-compensating', async () => {
    deps.prepareInvitation = vi.fn(async () => ({
      ok: true,
      data: {
        invitationId,
        status: 'prepared',
        shouldSend: true,
        operationKind: 'new_auth_user_invite',
      },
    }))
    deps.confirmInvitation = vi.fn(async () => ({
      ok: true,
      data: { status: 'failed' },
    }))
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(409)
    expect(await json(response)).toEqual({
      ok: false,
      error: {
        code: 'invitation_conflict',
        message: '该邀请已存在或请求已发生冲突。',
      },
    })
    // The confirmation already compensated the invitation; never double-mark.
    expect(deps.markInvitationFailed).not.toHaveBeenCalled()
  })

  it('compensates a failed Auth re-send without confirming', async () => {
    deps.prepareInvitation = vi.fn(async () => ({
      ok: true,
      data: {
        invitationId,
        status: 'reissue_prepared',
        shouldSend: true,
        operationKind: 'existing_invitee_reissue',
      },
    }))
    deps.inviteAuthUser = vi.fn(async () => ({
      ok: false,
      code: 'email_exists',
    }))
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(409)
    expect(deps.markInvitationFailed).toHaveBeenCalledWith(
      invitationId,
      'auth_user_conflict',
    )
    expect(deps.confirmInvitation).not.toHaveBeenCalled()
  })

  it('returns a safe temporary failure when confirmation fails', async () => {
    deps.prepareInvitation = vi.fn(async () => ({
      ok: true,
      data: {
        invitationId,
        status: 'reissue_prepared',
        shouldSend: true,
        operationKind: 'existing_invitee_reissue',
      },
    }))
    deps.confirmInvitation = vi.fn(async () => ({
      ok: false,
      code: 'database_unavailable',
    }))
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(503)
    expect(deps.markInvitationFailed).toHaveBeenCalledWith(
      invitationId,
      'temporary_failure',
    )
    const text = await response.text()
    expect(text).not.toContain('database_unavailable')
    expect(text).not.toContain('invitee@example.invalid')
  })

  it('keeps a thrown confirmation failure safe and compensated', async () => {
    deps.prepareInvitation = vi.fn(async () => ({
      ok: true,
      data: {
        invitationId,
        status: 'reissue_prepared',
        shouldSend: true,
        operationKind: 'existing_invitee_reissue',
      },
    }))
    deps.confirmInvitation = vi.fn(async () => {
      throw new Error('raw confirm detail')
    })
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(503)
    expect(deps.markInvitationFailed).toHaveBeenCalledWith(
      invitationId,
      'temporary_failure',
    )
    expect(await response.text()).not.toContain('raw confirm')
  })

  it('does not call Auth or confirm for an idempotent retry that must not send again', async () => {
    deps.prepareInvitation = vi.fn(async () => ({
      ok: true,
      data: {
        invitationId,
        status: 'reissue_prepared',
        shouldSend: false,
        operationKind: 'existing_invitee_reissue',
      },
    }))
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(409)
    expect(deps.inviteAuthUser).not.toHaveBeenCalled()
    expect(deps.confirmInvitation).not.toHaveBeenCalled()
  })

  it('maps a database auth_user_conflict to a fixed safe conflict', async () => {
    deps.prepareInvitation = vi.fn(async () => ({
      ok: false,
      code: 'workspace_invitation_auth_user_conflict',
    }))
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(409)
    expect(await json(response)).toEqual({
      ok: false,
      error: {
        code: 'invitation_conflict',
        message: '该邀请已存在或请求已发生冲突。',
      },
    })
    expect(deps.inviteAuthUser).not.toHaveBeenCalled()
  })

  it('keeps internal confirmation kind/state errors out of the browser response', async () => {
    deps.prepareInvitation = vi.fn(async () => ({
      ok: true,
      data: {
        invitationId,
        status: 'reissue_prepared',
        shouldSend: true,
        operationKind: 'existing_invitee_reissue',
      },
    }))
    deps.confirmInvitation = vi.fn(async () => ({
      ok: false,
      code: 'workspace_invitation_state_conflict',
    }))
    const handler = createInviteWorkspaceMemberHandler(deps)
    const response = await handler(request())

    expect(response.status).toBe(503)
    const text = await response.text()
    expect(text).not.toContain('state_conflict')
    expect(text).not.toContain('workspace_invitation')
    expect(text).not.toContain(invitationId)
    expect(deps.markInvitationFailed).toHaveBeenCalledWith(
      invitationId,
      'temporary_failure',
    )
  })

  it('never leaks the Auth user ID in responses or logs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      deps.prepareInvitation = vi.fn(async () => ({
        ok: true,
        data: {
          invitationId,
          status: 'reissue_prepared',
          shouldSend: true,
          operationKind: 'existing_invitee_reissue',
        },
      }))
      const handler = createInviteWorkspaceMemberHandler(deps)
      const response = await handler(request())
      const text = await response.text()

      expect(response.status).toBe(200)
      expect(text).not.toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
      expect(logSpy).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      logSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})

describe('business invitation TTL alignment', () => {
  it('defaults to the Auth email OTP expiry configured in supabase/config.toml', () => {
    const configToml = readFileSync(
      join(process.cwd(), 'supabase', 'config.toml'),
      'utf8',
    )
    const match = configToml.match(/otp_expiry\s*=\s*(\d+)/)
    expect(match).not.toBeNull()
    expect(Number(match?.[1])).toBe(DEFAULT_INVITE_TTL_SECONDS)
  })

  it('refuses startup for invalid, out-of-bounds or misaligned TTL values', () => {
    const fakeEnv = (value: string | undefined) => ({
      get: (name: string) =>
        name === 'APP_INVITE_TTL_SECONDS' ? value : undefined,
    })
    expect(parseInviteTtlSeconds(fakeEnv(undefined))).toBe(
      DEFAULT_INVITE_TTL_SECONDS,
    )
    expect(
      parseInviteTtlSeconds(fakeEnv(String(DEFAULT_INVITE_TTL_SECONDS))),
    ).toBe(DEFAULT_INVITE_TTL_SECONDS)
    expect(() => parseInviteTtlSeconds(fakeEnv('not-a-number'))).toThrow()
    expect(() => parseInviteTtlSeconds(fakeEnv('1.5'))).toThrow()
    expect(() =>
      parseInviteTtlSeconds(fakeEnv(String(MIN_INVITE_TTL_SECONDS - 1))),
    ).toThrow()
    expect(() =>
      parseInviteTtlSeconds(fakeEnv(String(MAX_INVITE_TTL_SECONDS + 1))),
    ).toThrow()
    expect(() =>
      parseInviteTtlSeconds(fakeEnv(String(DEFAULT_INVITE_TTL_SECONDS * 2))),
    ).toThrow()
  })
})
