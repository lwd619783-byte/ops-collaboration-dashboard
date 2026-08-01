import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { checkDatabaseHealth } from '@/lib/supabase/health'
import type { Database } from '@/types/database.generated'

function createClientResponse(response: unknown) {
  return {
    rpc: () => ({
      abortSignal: async () => response,
    }),
  } as unknown as SupabaseClient<Database>
}

describe('数据库健康检查服务', () => {
  it('接受类型正确且状态正常的 RPC 结果', async () => {
    const result = await checkDatabaseHealth(
      createClientResponse({
        data: [
          {
            status: 'ok',
            checked_at: '2026-07-30T12:00:00+00:00',
          },
        ],
        error: null,
      }),
      new AbortController().signal,
    )

    expect(result).toEqual({
      status: 'ok',
      checkedAt: '2026-07-30T12:00:00+00:00',
    })
  })

  it('把原始 Supabase 错误转换为不泄露内部信息的通用错误', async () => {
    const rawMessage = 'relation internal_table does not exist'
    const result = await checkDatabaseHealth(
      createClientResponse({
        data: null,
        error: { message: rawMessage, details: 'private schema detail' },
      }),
      new AbortController().signal,
    )

    expect(result.status).toBe('error')
    expect(JSON.stringify(result)).not.toContain(rawMessage)
    expect(JSON.stringify(result)).not.toContain('private schema detail')
  })

  it('拒绝缺失、重复或结构异常的返回结果', async () => {
    const responses = [
      { data: null, error: null },
      {
        data: [
          { status: 'ok', checked_at: '2026-07-30T12:00:00+00:00' },
          { status: 'ok', checked_at: '2026-07-30T12:00:00+00:00' },
        ],
        error: null,
      },
      {
        data: [{ status: 'unexpected', checked_at: 'not-a-date' }],
        error: null,
      },
    ]

    for (const response of responses) {
      await expect(
        checkDatabaseHealth(
          createClientResponse(response),
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({ status: 'error' })
    }
  })
})
