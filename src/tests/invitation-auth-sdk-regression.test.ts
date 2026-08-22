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

  it('CASE A: 受控 implicit 初始化在干净浏览器中建立 invitee session 并清理 fragment', async () => {
    const storageKey = `${STORAGE_KEY_PREFIX}-clean`
    const storage = createMemoryStorage(storageKey)
    const fetch = createAuthFetch()
    window.history.replaceState(
      null,
      '',
      `/activate-account#${invitationHash()}`,
    )

    const client = createFixtureClient(storage, fetch, storageKey, 'implicit')
    // The app replaces the history entry immediately after createClient().
    // auth-js 2.111.0 has already captured the parameters for initialization.
    window.history.replaceState(null, '', '/activate-account')
    const initialization = await client.auth.initialize()
    const { data } = await client.auth.getSession()

    expect(initialization.error).toBeNull()
    expect(data.session?.user.id).toBe(inviteeUser.id)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(window.location.hash).toBe('')
    expect(storage.setItem.mock.calls.map(([key]) => key)).toContain(storageKey)
  })

  it('CASE B: 有效 invitation callback 将 owner session 替换为 invitee session', async () => {
    const storageKey = `${STORAGE_KEY_PREFIX}-owner-switch`
    const ownerSession = createSession(ownerUser, 'owner')
    const storage = createMemoryStorage(storageKey, ownerSession)
    const fetch = createAuthFetch()
    window.history.replaceState(
      null,
      '',
      `/activate-account#${invitationHash()}`,
    )

    const client = createFixtureClient(storage, fetch, storageKey, 'implicit')
    window.history.replaceState(null, '', '/activate-account')
    const initialization = await client.auth.initialize()
    const { data } = await client.auth.getSession()

    expect(initialization.error).toBeNull()
    expect(data.session?.user.id).toBe(inviteeUser.id)
    expect(data.session?.user.id).not.toBe(ownerUser.id)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(window.location.hash).toBe('')
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
