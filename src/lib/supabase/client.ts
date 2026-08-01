import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.generated'
import {
  getSupabaseConfig,
  type SupabaseClientConfig,
} from '@/lib/supabase/config'

export type SupabaseClientResolution =
  | {
      status: 'ready'
      client: SupabaseClient<Database>
    }
  | {
      status: 'unavailable'
      reason: 'unconfigured' | 'invalid'
    }

let cachedClient:
  | {
      config: SupabaseClientConfig
      client: SupabaseClient<Database>
    }
  | undefined

export function getSupabaseClient(): SupabaseClientResolution {
  const configResult = getSupabaseConfig()
  if (configResult.status !== 'configured') {
    return {
      status: 'unavailable',
      reason: configResult.status,
    }
  }

  const { config } = configResult
  if (
    cachedClient?.config.url === config.url &&
    cachedClient.config.publishableKey === config.publishableKey
  ) {
    return { status: 'ready', client: cachedClient.client }
  }

  const client = createClient<Database>(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
  cachedClient = { config, client }
  return { status: 'ready', client }
}

export function resetSupabaseClientForTests() {
  cachedClient = undefined
}
