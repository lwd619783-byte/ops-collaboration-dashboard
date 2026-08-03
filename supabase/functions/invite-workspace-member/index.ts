import { createClient } from 'npm:@supabase/supabase-js@2.111.0'
import {
  createInviteWorkspaceMemberEntry,
  type SupabaseClientFactory,
} from './entry.ts'

// Production bootstrap: Deno supplies the environment and the serve function,
// and the real Supabase client is built with the server-side configuration.
// All wiring logic lives in entry.ts so it can be tested without Deno,
// network or real secrets.
const createSupabaseClient: SupabaseClientFactory = (url, key, options) =>
  createClient(url, key, options)

createInviteWorkspaceMemberEntry({
  env: Deno.env,
  serve: Deno.serve,
  createSupabaseClient,
})
