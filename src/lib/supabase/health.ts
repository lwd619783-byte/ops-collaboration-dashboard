import type { SupabaseClient } from '@supabase/supabase-js'
import { isDateTimeValue } from '@/lib/dates/dateDisplay'
import type { Database } from '@/types/database.generated'

const safeHealthCheckError =
  '暂时无法连接数据库，请稍后重试或联系系统维护人员。'

export type DatabaseHealthResult =
  | {
      status: 'ok'
      checkedAt: string
    }
  | {
      status: 'error'
      message: string
    }

export async function checkDatabaseHealth(
  client: SupabaseClient<Database>,
  signal: AbortSignal,
): Promise<DatabaseHealthResult> {
  try {
    const { data, error } = await client.rpc('health_check').abortSignal(signal)

    if (error || !data || data.length !== 1) {
      return { status: 'error', message: safeHealthCheckError }
    }

    const [result] = data
    if (
      !result ||
      result.status !== 'ok' ||
      !isDateTimeValue(result.checked_at)
    ) {
      return { status: 'error', message: safeHealthCheckError }
    }

    return { status: 'ok', checkedAt: result.checked_at }
  } catch {
    return { status: 'error', message: safeHealthCheckError }
  }
}
