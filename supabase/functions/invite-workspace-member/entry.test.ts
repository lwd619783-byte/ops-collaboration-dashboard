/**
 * Real-entry wiring tests: the production `index.ts` bootstrap is covered by
 * `deno check` in CI, and this module verifies the wiring factory with fake
 * clients — no real network, no real secrets. It asserts the security
 * properties that matter at the entry boundary:
 *   - caller client uses the publishable key and the caller Authorization;
 *   - admin client only ever holds the server secret;
 *   - the provider tenant comes from the verified token, never from the body;
 *   - mark-failed compensation uses the admin client;
 *   - startup refuses invalid/missing configuration;
 *   - environment values are never written to logs or responses.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createInviteWorkspaceMemberEntry,
  type EntryEnvironment,
  type SupabaseClientFactory,
} from './entry'

const allowedOrigin = 'http://127.0.0.1:3000'
const workspaceId = '11111111-1111-4111-8111-111111111111'
const idempotencyKey = '22222222-2222-4222-8222-222222222222'
const verifiedSubject = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const publishableKey = 'publishable-key-fixture'
const secretKey = 'secret-key-fixture'
const issuer = 'https://fictional-project.supabase.co/auth/v1'

const fullEnv = {
  SUPABASE_URL: 'https://fictional-project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: publishableKey,
  SUPABASE_SECRET_KEY: secretKey,
  APP_ALLOWED_ORIGINS: allowedOrigin,
}

function fakeEnv(overrides: Record<string, string> = {}): EntryEnvironment {
  return { get: (name: string) => overrides[name] }
}

function fictionalVerifiedToken(subject: string, tokenIssuer: string) {
  const encode = (value: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    const binary = String.fromCharCode(...bytes)
    return btoa(binary)
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  }
  return `${encode({ alg: 'none' })}.${encode({ sub: subject, iss: tokenIssuer })}.fixture`
}

type FakeClient = {
  url: string
  key: string
  options: Record<string, unknown>
  auth: {
    getUser: ReturnType<typeof vi.fn>
    admin: { inviteUserByEmail: ReturnType<typeof vi.fn> }
  }
  rpc: ReturnType<typeof vi.fn>
}

function fakeSupabaseClientFactory(): {
  factory: SupabaseClientFactory
  clients: FakeClient[]
} {
  const clients: FakeClient[] = []
  const factory: SupabaseClientFactory = (url, key, options) => {
    const client: FakeClient = {
      url,
      key,
      options,
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: verifiedSubject } },
          error: null,
        })),
        admin: {
          inviteUserByEmail: vi.fn(async () => ({ error: null })),
        },
      },
      rpc: vi.fn(async (name: string) => {
        if (name === 'prepare_workspace_invitation') {
          return {
            data: [
              {
                invitation_id: '33333333-3333-4333-8333-333333333333',
                invitation_status: 'prepared',
                should_send: true,
              },
            ],
            error: null,
          }
        }
        if (name === 'mark_workspace_invitation_failed') {
          return { data: 'failed', error: null }
        }
        return { data: null, error: null }
      }),
    }
    clients.push(client)
    return client
  }
  return { factory, clients }
}

function validRequest() {
  return new Request(
    'https://fictional-project.supabase.co/functions/v1/invite-workspace-member',
    {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fictionalVerifiedToken(verifiedSubject, issuer)}`,
      },
      body: JSON.stringify({
        workspaceId,
        email: 'invitee@example.invalid',
        displayName: 'Fictional Invitee',
        role: 'member',
        idempotencyKey,
      }),
    },
  )
}

describe('invite-workspace-member entry wiring', () => {
  let clients: FakeClient[]
  let factory: SupabaseClientFactory
  let serve: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const state = fakeSupabaseClientFactory()
    factory = state.factory
    clients = state.clients
    serve = vi.fn()
  })

  it('refuses startup when required server configuration is missing', () => {
    expect(() =>
      createInviteWorkspaceMemberEntry({
        env: fakeEnv({ SUPABASE_URL: 'https://fictional-project.supabase.co' }),
        serve,
        createSupabaseClient: factory,
      }),
    ).toThrow()
    expect(() =>
      createInviteWorkspaceMemberEntry({
        env: fakeEnv({
          ...fullEnv,
          SUPABASE_SECRET_KEY: undefined as unknown as string,
        }),
        serve,
        createSupabaseClient: factory,
      }),
    ).toThrow()
    expect(serve).not.toHaveBeenCalled()
  })

  it('refuses startup for invalid, out-of-bounds or misaligned TTL values', () => {
    for (const value of ['not-a-number', '1.5', '59', '999999', '7200']) {
      expect(() =>
        createInviteWorkspaceMemberEntry({
          env: fakeEnv({ ...fullEnv, APP_INVITE_TTL_SECONDS: value }),
          serve,
          createSupabaseClient: factory,
        }),
      ).toThrow()
    }
    expect(serve).not.toHaveBeenCalled()
  })

  it('registers the handler with an admin client that only holds the secret', () => {
    createInviteWorkspaceMemberEntry({
      env: fakeEnv(fullEnv),
      serve,
      createSupabaseClient: factory,
    })
    expect(serve).toHaveBeenCalledTimes(1)

    // The admin client is created eagerly at startup and never holds the
    // publishable key.
    expect(clients).toHaveLength(1)
    expect(clients[0]?.url).toBe('https://fictional-project.supabase.co')
    expect(clients[0]?.key).toBe(secretKey)
  })

  it('forwards the caller Authorization to a publishable-key caller client', async () => {
    createInviteWorkspaceMemberEntry({
      env: fakeEnv(fullEnv),
      serve,
      createSupabaseClient: factory,
    })
    const handler = serve.mock.calls[0]?.[0] as (
      request: Request,
    ) => Promise<Response>
    const response = await handler(validRequest())

    expect(response.status).toBe(200)
    // Caller clients are created lazily per request (one for official token
    // verification, one for the RLS-scoped preparation), always with the
    // publishable key and the caller's exact Authorization header.
    const callers = clients.filter((client) => client.key === publishableKey)
    expect(callers.length).toBeGreaterThanOrEqual(1)
    for (const caller of callers) {
      expect(caller.options).toEqual(
        expect.objectContaining({
          global: {
            headers: {
              Authorization: expect.stringMatching(/^Bearer /),
            },
          },
        }),
      )
    }
    // Official token verification runs through a caller client.
    expect(callers[0]?.auth.getUser).toHaveBeenCalledTimes(1)
  })

  it('prepares invitations with the caller client and invites with the admin client', async () => {
    createInviteWorkspaceMemberEntry({
      env: fakeEnv(fullEnv),
      serve,
      createSupabaseClient: factory,
    })
    const handler = serve.mock.calls[0]?.[0] as (
      request: Request,
    ) => Promise<Response>
    const response = await handler(validRequest())

    expect(response.status).toBe(200)
    const callers = clients.filter(
      (client): client is FakeClient => client.key === publishableKey,
    )
    const caller = callers.at(-1) as FakeClient | undefined
    const admin = clients[0] as FakeClient | undefined
    expect(caller?.rpc).toHaveBeenCalledWith(
      'prepare_workspace_invitation',
      expect.objectContaining({
        p_workspace_id: workspaceId,
        p_idempotency_key: idempotencyKey,
      }),
    )
    // The preparation payload contains neither an expiry nor the plaintext
    // email: the database is the only expiry authority.
    const prepareParams = caller?.rpc.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >
    expect(prepareParams).not.toHaveProperty('p_expires_at')
    expect(JSON.stringify(prepareParams)).not.toContain(
      'invitee@example.invalid',
    )
    expect(admin?.auth.admin.inviteUserByEmail).toHaveBeenCalledTimes(1)
    expect(admin?.auth.admin.inviteUserByEmail).toHaveBeenCalledWith(
      'invitee@example.invalid',
      expect.objectContaining({
        redirectTo: `${allowedOrigin}/activate-account`,
      }),
    )
  })

  it('never accepts a browser-supplied provider tenant', async () => {
    createInviteWorkspaceMemberEntry({
      env: fakeEnv(fullEnv),
      serve,
      createSupabaseClient: factory,
    })
    const handler = serve.mock.calls[0]?.[0] as (
      request: Request,
    ) => Promise<Response>
    const request = validRequest()
    const body = JSON.parse(await request.text()) as Record<string, unknown>
    body.providerTenant = 'https://untrusted.invalid/auth/v1'
    const forgedRequest = new Request(request, {
      body: JSON.stringify(body),
    })
    const response = await handler(forgedRequest)

    expect(response.status).toBe(200)
    const admin = clients[0] as FakeClient | undefined
    const metadata = admin?.auth.admin.inviteUserByEmail.mock.calls[0]?.[1] as {
      data: Record<string, string>
    }
    expect(metadata.data.ops_provider_tenant).toBe(issuer)
    expect(metadata.data.ops_provider_tenant).not.toContain('untrusted')
  })

  it('compensates Auth Admin failures through the admin client only', async () => {
    createInviteWorkspaceMemberEntry({
      env: fakeEnv(fullEnv),
      serve,
      createSupabaseClient: factory,
    })
    const admin = clients[0] as FakeClient
    admin.auth.admin.inviteUserByEmail.mockResolvedValue({
      error: { code: 'email_exists' },
    })
    const handler = serve.mock.calls[0]?.[0] as (
      request: Request,
    ) => Promise<Response>
    const response = await handler(validRequest())

    expect(response.status).toBe(409)
    expect(admin.rpc).toHaveBeenCalledWith('mark_workspace_invitation_failed', {
      p_invitation_id: '33333333-3333-4333-8333-333333333333',
      p_failure_code: 'auth_user_conflict',
    })
  })

  it('never writes environment values or keys to logs or responses', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      createInviteWorkspaceMemberEntry({
        env: fakeEnv(fullEnv),
        serve,
        createSupabaseClient: factory,
      })
      const handler = serve.mock.calls[0]?.[0] as (
        request: Request,
      ) => Promise<Response>
      const response = await handler(validRequest())
      const text = await response.text()

      expect(logSpy).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
      expect(text).not.toContain(publishableKey)
      expect(text).not.toContain(secretKey)
      expect(text).not.toContain('fictional-token')
      expect(text).not.toContain('invitee@example.invalid')
    } finally {
      logSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})
