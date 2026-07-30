import { describe, expect, it } from 'vitest'
import { parseSupabaseConfig } from '@/lib/supabase/config'

function createLegacyJwt(role: string) {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role })}.signature`
}

const publishableKey = 'sb_publishable_test-key'

describe('Supabase 浏览器配置', () => {
  it('缺少 URL 时返回未配置状态', () => {
    expect(
      parseSupabaseConfig(
        { VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey },
        { isDevelopment: true },
      ),
    ).toEqual({ status: 'unconfigured', missing: ['url'] })
  })

  it('缺少 publishable key 时返回未配置状态', () => {
    expect(
      parseSupabaseConfig(
        { VITE_SUPABASE_URL: 'http://127.0.0.1:54321' },
        { isDevelopment: true },
      ),
    ).toEqual({ status: 'unconfigured', missing: ['publishableKey'] })
  })

  it('拒绝非法 URL', () => {
    expect(
      parseSupabaseConfig(
        {
          VITE_SUPABASE_URL: 'not-a-url',
          VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
        },
        { isDevelopment: true },
      ),
    ).toMatchObject({ status: 'invalid' })
  })

  it('拒绝托管环境的 HTTP URL', () => {
    expect(
      parseSupabaseConfig(
        {
          VITE_SUPABASE_URL: 'http://example.test',
          VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
        },
        { isDevelopment: false },
      ),
    ).toMatchObject({ status: 'invalid' })
  })

  it.each(['localhost', '127.0.0.1'])(
    '本地开发接受 %s 的 HTTP URL',
    (hostname) => {
      expect(
        parseSupabaseConfig(
          {
            VITE_SUPABASE_URL: `http://${hostname}:54321`,
            VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
          },
          { isDevelopment: true },
        ),
      ).toMatchObject({ status: 'configured' })
    },
  )

  it('托管环境接受 HTTPS URL 和 publishable key', () => {
    expect(
      parseSupabaseConfig(
        {
          VITE_SUPABASE_URL: 'https://example.test',
          VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
        },
        { isDevelopment: false },
      ),
    ).toEqual({
      status: 'configured',
      config: {
        url: 'https://example.test',
        publishableKey,
      },
    })
  })

  it('本地开发接受 role 为 anon 的旧式低权限 JWT', () => {
    expect(
      parseSupabaseConfig(
        {
          VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
          VITE_SUPABASE_PUBLISHABLE_KEY: createLegacyJwt('anon'),
        },
        { isDevelopment: true },
      ),
    ).toMatchObject({ status: 'configured' })
  })

  it('拒绝 secret key', () => {
    expect(
      parseSupabaseConfig(
        {
          VITE_SUPABASE_URL: 'https://example.test',
          VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_test-key',
        },
        { isDevelopment: false },
      ),
    ).toMatchObject({ status: 'invalid' })
  })

  it('拒绝 role 为 service_role 的旧式 JWT', () => {
    expect(
      parseSupabaseConfig(
        {
          VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
          VITE_SUPABASE_PUBLISHABLE_KEY: createLegacyJwt('service_role'),
        },
        { isDevelopment: true },
      ),
    ).toMatchObject({ status: 'invalid' })
  })

  it('错误文本不包含提交的 key', () => {
    const rejectedKey = 'sb_secret_never-show-this-value'
    const result = parseSupabaseConfig(
      {
        VITE_SUPABASE_URL: 'https://example.test',
        VITE_SUPABASE_PUBLISHABLE_KEY: rejectedKey,
      },
      { isDevelopment: false },
    )

    expect(result.status).toBe('invalid')
    expect(JSON.stringify(result)).not.toContain(rejectedKey)
  })
})
