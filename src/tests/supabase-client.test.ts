import { beforeEach, describe, expect, it } from 'vitest'
import {
  getSupabaseClient,
  resetSupabaseClientForTests,
} from '@/lib/supabase/client'
import type { SupabaseConfigResult } from '@/lib/supabase/config'

const configured: SupabaseConfigResult = {
  status: 'configured',
  config: {
    url: 'https://example.test',
    publishableKey: 'sb_publishable_test-key',
  },
}

describe('Supabase 客户端工厂', () => {
  beforeEach(() => resetSupabaseClientForTests())

  it('配置缺失时返回不可用结果而不抛异常', () => {
    expect(
      getSupabaseClient({
        status: 'unconfigured',
        missing: ['url', 'publishableKey'],
      }),
    ).toEqual({ status: 'unavailable', reason: 'unconfigured' })
  })

  it('相同配置只创建一个受控客户端实例', () => {
    const first = getSupabaseClient(configured)
    const second = getSupabaseClient(configured)

    expect(first.status).toBe('ready')
    expect(second.status).toBe('ready')
    if (first.status === 'ready' && second.status === 'ready') {
      expect(second.client).toBe(first.client)
    }
  })
})
