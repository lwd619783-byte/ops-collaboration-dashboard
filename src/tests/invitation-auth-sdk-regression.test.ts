import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type User } from '@supabase/supabase-js'

const AUTH_URL = 'https://auth-fixture.invalid'
const PUBLISHABLE_KEY = 'sb_publishable_f2-fixture'
const STORAGE_KEY_PREFIX = 'f2-auth-sdk-fixture'

const inviteeUser: User = {
  id: '11111111-1111-4111-8111-111111111111',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'invitee@example.invalid',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-08-22T00:00:00.000Z',
}

const ownerUser: User = {
  ...inviteeUser,
  id: '22222222-2222-4222-8222-222222222222',
  email: 'owner@example.invalid',
}

function createFixtureJwt(subject: string) {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    sub: subject,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.fixture`
}

function createMemoryStorage(storageKey: string, initialSession?: object) {
  const entries = new Map<string, string>()
  if (initialSession) {
    entries.set(storageKey, JSON.stringify(initialSession))
  }
  return {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      entries.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      entries.delete(key)
    }),
  }
}

function createSession(user: User, prefix: string) {
  return {
    access_token: createFixtureJwt(user.id),
    refresh_token: `${prefix}-refresh-fixture`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer' as const,
    user,
  }
}

function createAuthFetch(session = createSession(inviteeUser, 'invitee')) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify(inviteeUser), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('/auth/v1/token?grant_type=pkce')) {
      return new Response(JSON.stringify(session), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`Unexpected synthetic Auth request: ${url}`)
  })
}

function createFixtureClient(
  storage: ReturnType<typeof createMemoryStorage>,
  fetch: ReturnType<typeof createAuthFetch>,
  storageKey: string,
  flowType: 'implicit' | 'pkce',
) {
  return createClient(AUTH_URL, PUBLISHABLE_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: true,
      flowType,
      persistSession: true,
      storage,
      storageKey,
    },
    global: { fetch },
  })
}

function invitationHash(session = createSession(inviteeUser, 'invitee')) {
  return new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: String(session.expires_in),
    expires_at: String(session.expires_at),
    token_type: session.token_type,
    type: 'invite',
  }).toString()
}

describe('锁定 Auth SDK 的 invitation callback 回归基线', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
    vi.unstubAllGlobals()
  })

  it('根因契约: PKCE 客户端拒绝 implicit invitation callback', async () => {
    const storageKey = `${STORAGE_KEY_PREFIX}-root-cause`
    const storage = createMemoryStorage(storageKey)
    const fetch = createAuthFetch()
    window.history.replaceState(
      null,
      '',
      `/activate-account#${invitationHash()}`,
    )

    const client = createFixtureClient(storage, fetch, storageKey, 'pkce')
    const { data } = await client.auth.getSession()

    expect(data.session).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(window.location.hash).toContain('access_token=')
  })

  it('隔离 implicit client 在内存认证 incoming session，不写传入 storage', async () => {
    const storageKey = `${STORAGE_KEY_PREFIX}-ephemeral`
    const storage = createMemoryStorage(storageKey)
    const fetch = createAuthFetch()
    window.history.replaceState(
      null,
      '',
      `/activate-account#${invitationHash()}`,
    )

    const client = createClient(AUTH_URL, PUBLISHABLE_KEY, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: true,
        flowType: 'implicit',
        persistSession: false,
        storage,
        storageKey,
        skipAutoInitialize: true,
      },
      global: { fetch },
    })
    const initializationPromise = client.auth.initialize()
    // initialize() has captured the fragment before its Auth request await.
    window.history.replaceState(null, '', '/activate-account')
    const initialization = await initializationPromise
    const { data } = await client.auth.getSession()

    expect(initialization.error).toBeNull()
    expect(data.session?.user.id).toBe(inviteeUser.id)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(window.location.hash).toBe('')
    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
    await client.auth.dispose()
  })

  it('ephemeral authenticated identity 可调用无 user-id 参数的 pending-invitation RPC', async () => {
    const storageKey = `${STORAGE_KEY_PREFIX}-eligibility-rpc`
    const storage = createMemoryStorage(storageKey)
    const session = createSession(inviteeUser, 'eligibility')
    const refreshedSession = {
      ...createSession(inviteeUser, 'eligibility-rotated'),
      refresh_token: 'eligibility-rotated-refresh-fixture',
    }
    let rpcAuthorization: string | null = null
    let rpcBody = ''
    let refreshBody = ''
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        if (request.url.endsWith('/auth/v1/user')) {
          return new Response(JSON.stringify(inviteeUser), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (request.url.endsWith('/auth/v1/token?grant_type=refresh_token')) {
          refreshBody = await request.text()
          return new Response(JSON.stringify(refreshedSession), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (
          request.url.endsWith(
            '/rest/v1/rpc/list_my_pending_workspace_invitations',
          )
        ) {
          rpcAuthorization = request.headers.get('Authorization')
          rpcBody = await request.text()
          return new Response(
            JSON.stringify([
              {
                invitation_id: '33333333-3333-4333-8333-333333333333',
                workspace_id: '44444444-4444-4444-8444-444444444444',
                workspace_name: 'Synthetic Workspace',
                role: 'member',
                status: 'sent',
                expires_at: '2099-01-01T00:00:00.000Z',
              },
            ]),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        throw new Error(`Unexpected synthetic request: ${request.url}`)
      },
    )
    window.history.replaceState(
      null,
      '',
      `/activate-account#${invitationHash(session)}`,
    )
    const client = createClient(AUTH_URL, PUBLISHABLE_KEY, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: true,
        flowType: 'implicit',
        persistSession: false,
        storage,
        storageKey,
        skipAutoInitialize: true,
      },
      global: { fetch },
    })
    const initialization = client.auth.initialize()
    window.history.replaceState(null, '', '/activate-account')
    await initialization
    const refreshed = await client.auth.refreshSession({
      refresh_token: session.refresh_token,
    })

    const eligibility = await client.rpc(
      'list_my_pending_workspace_invitations',
    )

    expect(refreshed.error).toBeNull()
    expect(refreshed.data.session?.refresh_token).toBe(
      refreshedSession.refresh_token,
    )
    expect(refreshBody).toContain(session.refresh_token)
    expect(eligibility.error).toBeNull()
    expect(eligibility.data).toHaveLength(1)
    expect(rpcAuthorization).toBe(`Bearer ${refreshedSession.access_token}`)
    expect(rpcBody).not.toContain(inviteeUser.id)
    expect(storage.setItem).not.toHaveBeenCalled()
    await client.auth.dispose()
  })

  it('隔离 callback 初始化不覆盖 owner storage，也不创建或发布共享 BroadcastChannel', async () => {
    const storageKey = `${STORAGE_KEY_PREFIX}-owner-isolation`
    const callbackStorageKey = `${STORAGE_KEY_PREFIX}-callback-only`
    const ownerSession = createSession(ownerUser, 'owner')
    const storage = createMemoryStorage(storageKey, ownerSession)
    const callbackStorage = createMemoryStorage(callbackStorageKey)
    const fetch = createAuthFetch()
    const channels: Array<{
      name: string
      postMessage: ReturnType<typeof vi.fn>
    }> = []
    class BroadcastChannelProbe {
      name: string
      postMessage = vi.fn()
      addEventListener = vi.fn()
      close = vi.fn()

      constructor(name: string) {
        this.name = name
        channels.push(this)
      }
    }
    vi.stubGlobal('BroadcastChannel', BroadcastChannelProbe)

    const ownerClient = createFixtureClient(storage, fetch, storageKey, 'pkce')
    await ownerClient.auth.initialize()
    for (const channel of channels) channel.postMessage.mockClear()
    window.history.replaceState(
      null,
      '',
      `/activate-account#${invitationHash()}`,
    )

    const callbackClient = createClient(AUTH_URL, PUBLISHABLE_KEY, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: true,
        flowType: 'implicit',
        persistSession: false,
        storage: callbackStorage,
        storageKey: callbackStorageKey,
        skipAutoInitialize: true,
      },
      global: { fetch },
    })
    const callbackInitialization = callbackClient.auth.initialize()
    window.history.replaceState(null, '', '/activate-account')
    const initialization = await callbackInitialization
    const callbackSession = await callbackClient.auth.getSession()
    const ownerAfterCallback = await ownerClient.auth.getSession()

    expect(initialization.error).toBeNull()
    expect(callbackSession.data.session?.user.id).toBe(inviteeUser.id)
    expect(ownerAfterCallback.data.session?.user.id).toBe(ownerUser.id)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(window.location.hash).toBe('')
    expect(callbackStorage.setItem).not.toHaveBeenCalled()
    expect(channels.map(({ name }) => name)).toEqual([storageKey])
    expect(channels[0].postMessage).not.toHaveBeenCalled()
    await callbackClient.auth.dispose()
    await ownerClient.auth.dispose()
  })

  it('正式 setSession handoff 才写正常 storage 并发布正常 SIGNED_IN', async () => {
    const storageKey = `${STORAGE_KEY_PREFIX}-authorized-handoff`
    const storage = createMemoryStorage(storageKey)
    const fetch = createAuthFetch()
    const postMessage = vi.fn()
    class BroadcastChannelProbe {
      postMessage = postMessage
      addEventListener = vi.fn()
      close = vi.fn()
    }
    vi.stubGlobal('BroadcastChannel', BroadcastChannelProbe)
    const client = createFixtureClient(storage, fetch, storageKey, 'pkce')
    await client.auth.initialize()
    postMessage.mockClear()
    const incomingSession = createSession(inviteeUser, 'invitee')

    const result = await client.auth.setSession({
      access_token: incomingSession.access_token,
      refresh_token: incomingSession.refresh_token,
    })

    expect(result.error).toBeNull()
    expect(result.data.session?.user.id).toBe(inviteeUser.id)
    expect(storage.setItem.mock.calls.map(([key]) => key)).toContain(storageKey)
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage.mock.calls[0][0].event).toBe('SIGNED_IN')
    await client.auth.dispose()
  })

  it('CASE C: app 先清理 invalid callback，PKCE client 安全保留 owner session', async () => {
    const storageKey = `${STORAGE_KEY_PREFIX}-invalid`
    const ownerSession = createSession(ownerUser, 'owner')
    const storage = createMemoryStorage(storageKey, ownerSession)
    const fetch = createAuthFetch()
    window.history.replaceState(
      null,
      '',
      '/activate-account#error=access_denied&error_code=otp_expired&error_description=Fictional+expired+link&type=invite',
    )

    window.history.replaceState(null, '', '/activate-account')
    const client = createFixtureClient(storage, fetch, storageKey, 'pkce')
    const { data } = await client.auth.getSession()

    expect(data.session?.user.id).toBe(ownerUser.id)
    expect(fetch).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('')
  })

  it('CASE D: 正常 PKCE recovery callback 建立 session 并清理 code', async () => {
    const storageKey = `${STORAGE_KEY_PREFIX}-recovery`
    const recoverySession = createSession(inviteeUser, 'recovery')
    const storage = createMemoryStorage(storageKey)
    storage.setItem(
      `${storageKey}-code-verifier`,
      JSON.stringify('fixture-verifier/recovery'),
    )
    const fetch = createAuthFetch(recoverySession)
    window.history.replaceState(
      null,
      '',
      '/reset-password?code=fixture-authorization-code',
    )

    const client = createFixtureClient(storage, fetch, storageKey, 'pkce')
    const initialization = await client.auth.initialize()
    const { data } = await client.auth.getSession()

    expect(initialization.error).toBeNull()
    expect(storage.getItem.mock.calls.map(([key]) => key)).toContain(
      `${storageKey}-code-verifier`,
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(storage.setItem.mock.calls.map(([key]) => key)).toContain(storageKey)
    expect(data.session?.user.id).toBe(inviteeUser.id)
    expect(window.location.search).toBe('')
  })
})
