import { describe, expect, it } from 'vitest'
import { parseSupabaseConfig } from '@/lib/supabase/config'
import { forbiddenSupabaseFrontendEnvironmentNames } from '@/lib/supabase/config-validation'

function createLegacyJwt(role: string) {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role })}.fixture`
}

const publishableKey = 'sb_publishable_test-key'
const safeInvalidMessage = '检测到不安全或无效的 Supabase 前端配置。'

describe('Supabase 共享前端配置验证', () => {
  it('URL 和 publishable key 都缺少时返回未配置状态', () => {
    expect(parseSupabaseConfig({}, { isDevelopment: true })).toEqual({
      status: 'unconfigured',
      missing: ['url', 'publishableKey'],
    })
  })

  it('仅缺少 URL 时返回脱敏的无效状态', () => {
    expect(
      parseSupabaseConfig(
        { VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey },
        { isDevelopment: true },
      ),
    ).toEqual({ status: 'invalid', message: safeInvalidMessage })
  })

  it('仅缺少 publishable key 时返回脱敏的无效状态', () => {
    expect(
      parseSupabaseConfig(
        { VITE_SUPABASE_URL: 'http://127.0.0.1:54321' },
        { isDevelopment: true },
      ),
    ).toEqual({ status: 'invalid', message: safeInvalidMessage })
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
    ).toEqual({ status: 'invalid', message: safeInvalidMessage })
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
    ).toEqual({ status: 'invalid', message: safeInvalidMessage })
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

  it('拒绝无法安全识别的旧式 JWT', () => {
    expect(
      parseSupabaseConfig(
        {
          VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
          VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture.invalid.jwt',
        },
        { isDevelopment: true },
      ),
    ).toEqual({ status: 'invalid', message: safeInvalidMessage })
  })

  it('拒绝 secret key', () => {
    expect(
      parseSupabaseConfig(
        {
          VITE_SUPABASE_URL: 'https://example.test',
          VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_test-fixture',
        },
        { isDevelopment: false },
      ),
    ).toEqual({ status: 'invalid', message: safeInvalidMessage })
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
    ).toEqual({ status: 'invalid', message: safeInvalidMessage })
  })

  it.each(forbiddenSupabaseFrontendEnvironmentNames)(
    '拒绝非空禁止变量 %s',
    (name) => {
      expect(
        parseSupabaseConfig(
          { [name]: 'forbidden-variable-fixture' },
          { isDevelopment: true },
        ),
      ).toEqual({ status: 'invalid', message: safeInvalidMessage })
    },
  )

  it('错误文本不包含提交的 URL 或 key', () => {
    const rejectedUrl = 'https://rejected-config.test'
    const rejectedKey = 'sb_secret_never-show-this-fixture'
    const result = parseSupabaseConfig(
      {
        VITE_SUPABASE_URL: rejectedUrl,
        VITE_SUPABASE_PUBLISHABLE_KEY: rejectedKey,
      },
      { isDevelopment: false },
    )

    expect(result).toEqual({
      status: 'invalid',
      message: safeInvalidMessage,
    })
    expect(JSON.stringify(result)).not.toContain(rejectedUrl)
    expect(JSON.stringify(result)).not.toContain(rejectedKey)
  })
})
