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

  // Task 1.3: the web auth flow requires session persistence, automatic token
  // refresh and URL-based callback detection (PKCE recovery flow). The client
  // stays a singleton that only reads the two public, low-privilege variables
  // from the shared validator; it never accepts caller-supplied credentials.
  const client = createClient<Database>(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      flowType: 'pkce',
    },
  })
  cachedClient = { config, client }
  return { status: 'ready', client }
}

export function resetSupabaseClientForTests() {
  cachedClient = undefined
}
