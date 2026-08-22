import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(() => ({ rpc: vi.fn() })),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}))

import {
  classifyInvitationCallback,
  getSupabaseClient,
  resetSupabaseClientForTests,
} from '@/lib/supabase/client'
import { forbiddenSupabaseFrontendEnvironmentNames } from '@/lib/supabase/config-validation'

function createLegacyJwt(role: string) {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role })}.fixture`
}

function stubSupabaseEnvironment(overrides: Record<string, string> = {}) {
  vi.stubEnv('VITE_SUPABASE_URL', '')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
  for (const name of forbiddenSupabaseFrontendEnvironmentNames) {
    vi.stubEnv(name, '')
  }
  for (const [name, value] of Object.entries(overrides)) {
    vi.stubEnv(name, value)
  }
}

describe('Supabase 客户端工厂安全边界', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
    stubSupabaseEnvironment()
    resetSupabaseClientForTests()
    createClientMock.mockClear()
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
    vi.unstubAllEnvs()
  })

  it('生产接口不接受参数', () => {
    expect(getSupabaseClient.length).toBe(0)
  })

  it('配置缺失时不创建客户端', () => {
    expect(getSupabaseClient()).toEqual({
      status: 'unavailable',
      reason: 'unconfigured',
    })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('secret key 配置时不创建客户端', () => {
    const rejectedKey = 'sb_secret_client-fixture'
    stubSupabaseEnvironment({
      VITE_SUPABASE_URL: 'https://client.test',
      VITE_SUPABASE_PUBLISHABLE_KEY: rejectedKey,
    })

    const result = getSupabaseClient()
    expect(result).toEqual({ status: 'unavailable', reason: 'invalid' })
    expect(JSON.stringify(result)).not.toContain(rejectedKey)
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('service-role JWT 配置时不创建客户端', () => {
    stubSupabaseEnvironment({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: createLegacyJwt('service_role'),
    })

    expect(getSupabaseClient()).toEqual({
      status: 'unavailable',
      reason: 'invalid',
    })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('禁止变量非空时不创建客户端', () => {
    stubSupabaseEnvironment({
      VITE_SUPABASE_SECRET_KEY: 'forbidden-client-fixture',
    })

    expect(getSupabaseClient()).toEqual({
      status: 'unavailable',
      reason: 'invalid',
    })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('相同合法配置只创建一个受控客户端实例', () => {
    stubSupabaseEnvironment({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_client-fixture',
    })

    const first = getSupabaseClient()
    const second = getSupabaseClient()

    expect(first.status).toBe('ready')
    expect(second.status).toBe('ready')
    expect(createClientMock).toHaveBeenCalledTimes(1)
    expect(createClientMock).toHaveBeenCalledWith(
      'http://127.0.0.1:54321',
      'sb_publishable_client-fixture',
      {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true,
          flowType: 'pkce',
        },
      },
    )
    if (first.status === 'ready' && second.status === 'ready') {
      expect(second.client).toBe(first.client)
    }
  })

  it('配置变化时创建新的受控实例', () => {
    stubSupabaseEnvironment({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_first-fixture',
    })
    const first = getSupabaseClient()

    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_second-fixture')
    const second = getSupabaseClient()

    expect(first.status).toBe('ready')
    expect(second.status).toBe('ready')
    expect(createClientMock).toHaveBeenCalledTimes(2)
    if (first.status === 'ready' && second.status === 'ready') {
      expect(second.client).not.toBe(first.client)
    }
  })

  it('仅 exact activation route 的完整 invite fragment 选择 implicit 并立即清理地址栏', () => {
    stubSupabaseEnvironment({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_client-fixture',
    })
    window.history.replaceState(
      null,
      '',
      '/activate-account#access_token=f2-access-fixture&refresh_token=f2-refresh-fixture&expires_in=3600&expires_at=2000000000&token_type=bearer&type=invite',
    )

    const result = getSupabaseClient()
    // StrictMode/remount-equivalent resolution happens after the factory has
    // already removed the fragment. It must reuse the callback client and its
    // lifecycle instead of creating a competing PKCE client.
    const repeatedResult = getSupabaseClient()

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.invitationCallback?.status).toBe('pending')
    expect(repeatedResult.status).toBe('ready')
    if (repeatedResult.status === 'ready') {
      expect(repeatedResult.client).toBe(result.client)
      expect(repeatedResult.invitationCallback).toBe(result.invitationCallback)
    }
    expect(createClientMock).toHaveBeenCalledTimes(1)
    expect(createClientMock).toHaveBeenCalledWith(
      'http://127.0.0.1:54321',
      'sb_publishable_client-fixture',
      {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true,
          flowType: 'implicit',
        },
      },
    )
    expect(window.location.pathname).toBe('/activate-account')
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('')
  })

  it.each([
    '/activate-account#error=access_denied&error_code=otp_expired&error_description=Fictional+expired+link&type=invite',
    '/activate-account?error=access_denied&error_code=otp_expired',
  ])(
    'error/malformed invitation callback fail closed、清理 URL 且保留 PKCE: %s',
    (callbackUrl) => {
      stubSupabaseEnvironment({
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_client-fixture',
      })
      window.history.replaceState(null, '', callbackUrl)

      const result = getSupabaseClient()

      expect(result.status).toBe('ready')
      if (result.status !== 'ready') return
      expect(result.invitationCallback).toEqual({ status: 'invalid' })
      expect(createClientMock).toHaveBeenCalledWith(
        'http://127.0.0.1:54321',
        'sb_publishable_client-fixture',
        {
          auth: {
            autoRefreshToken: true,
            detectSessionInUrl: true,
            persistSession: true,
            flowType: 'pkce',
          },
        },
      )
      expect(window.location.hash).toBe('')
      expect(window.location.search).toBe('')
    },
  )

  it.each([
    {
      name: 'wrong route',
      pathname: '/projects',
      hash: '#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer&type=invite',
    },
    {
      name: 'query cannot switch flow',
      pathname: '/activate-account?type=invite&access_token=a',
      hash: '',
    },
    {
      name: 'wrong callback type',
      pathname: '/activate-account',
      hash: '#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer&type=recovery',
    },
    {
      name: 'unexpected fragment field',
      pathname: '/activate-account',
      hash: '#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer&type=invite&returnTo=%2Fprojects',
    },
    {
      name: 'arbitrary returnTo query with otherwise valid fragment',
      pathname: '/activate-account?returnTo=%2Fprojects',
      hash: '#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer&type=invite',
    },
    {
      name: 'duplicate callback type',
      pathname: '/activate-account',
      hash: '#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer&type=invite&type=recovery',
    },
  ])('$name 不会成为 valid invitation callback', ({ pathname, hash }) => {
    const url = new URL(`${pathname}${hash}`, window.location.origin)
    expect(classifyInvitationCallback(url).status).not.toBe('valid')
  })
})
