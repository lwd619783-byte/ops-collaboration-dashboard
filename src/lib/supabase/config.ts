import {
  parseSupabaseConfig,
  type SupabaseEnvironment,
} from '@/lib/supabase/config-validation'

export {
  parseSupabaseConfig,
  type SupabaseClientConfig,
  type SupabaseConfigResult,
} from '@/lib/supabase/config-validation'

function readSupabaseEnvironment(): SupabaseEnvironment {
  return {
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env
      .VITE_SUPABASE_PUBLISHABLE_KEY,
    VITE_SUPABASE_SECRET_KEY: import.meta.env.VITE_SUPABASE_SECRET_KEY,
    VITE_SUPABASE_SERVICE_ROLE_KEY: import.meta.env
      .VITE_SUPABASE_SERVICE_ROLE_KEY,
    VITE_SUPABASE_DB_URL: import.meta.env.VITE_SUPABASE_DB_URL,
    VITE_DATABASE_URL: import.meta.env.VITE_DATABASE_URL,
    VITE_DATABASE_PASSWORD: import.meta.env.VITE_DATABASE_PASSWORD,
    VITE_SUPABASE_DATABASE_PASSWORD: import.meta.env
      .VITE_SUPABASE_DATABASE_PASSWORD,
    VITE_SUPABASE_JWT_SECRET: import.meta.env.VITE_SUPABASE_JWT_SECRET,
  }
}

export function getSupabaseConfig() {
  return parseSupabaseConfig(readSupabaseEnvironment(), {
    isDevelopment: import.meta.env.DEV,
  })
}
