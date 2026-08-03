import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(() => ({ rpc: vi.fn() })),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}))

import {
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
    stubSupabaseEnvironment()
    resetSupabaseClientForTests()
    createClientMock.mockClear()
  })

  afterEach(() => vi.unstubAllEnvs())

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
})
