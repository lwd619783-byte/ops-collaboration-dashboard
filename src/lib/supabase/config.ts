export type SupabaseClientConfig = {
  url: string
  publishableKey: string
}

export type SupabaseConfigResult =
  | {
      status: 'configured'
      config: SupabaseClientConfig
    }
  | {
      status: 'unconfigured'
      missing: Array<'url' | 'publishableKey'>
    }
  | {
      status: 'invalid'
      message: string
    }

type SupabaseEnvironment = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

type ParseOptions = {
  isDevelopment: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function decodeJwtRole(token: string) {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return undefined

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '=',
    )
    const bytes = Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    )
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return isRecord(payload) && typeof payload.role === 'string'
      ? payload.role
      : undefined
  } catch {
    return undefined
  }
}

function isLocalHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function validatePublishableKey(
  key: string,
  isDevelopment: boolean,
  isLocalUrl: boolean,
) {
  if (key.startsWith('sb_secret_')) return false
  if (/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(key)) return true

  const legacyRole = decodeJwtRole(key)
  if (legacyRole === 'service_role') return false
  return isDevelopment && isLocalUrl && legacyRole === 'anon'
}

export function parseSupabaseConfig(
  environment: SupabaseEnvironment,
  options: ParseOptions,
): SupabaseConfigResult {
  const rawUrl = environment.VITE_SUPABASE_URL?.trim()
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  const missing: Array<'url' | 'publishableKey'> = []

  if (!rawUrl) missing.push('url')
  if (!publishableKey) missing.push('publishableKey')
  if (missing.length > 0 || !rawUrl || !publishableKey) {
    return { status: 'unconfigured', missing }
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { status: 'invalid', message: 'Supabase URL 格式无效。' }
  }

  const isLocalUrl = isLocalHostname(url.hostname)
  const usesHttps = url.protocol === 'https:'
  const usesAllowedLocalHttp =
    options.isDevelopment && isLocalUrl && url.protocol === 'http:'

  if (!usesHttps && !usesAllowedLocalHttp) {
    return {
      status: 'invalid',
      message: 'Supabase URL 必须使用 HTTPS；本地开发地址可以使用 HTTP。',
    }
  }

  if (
    !validatePublishableKey(publishableKey, options.isDevelopment, isLocalUrl)
  ) {
    return {
      status: 'invalid',
      message: 'Supabase publishable key 无效或权限过高。',
    }
  }

  return {
    status: 'configured',
    config: {
      url: url.toString().replace(/\/$/, ''),
      publishableKey,
    },
  }
}

export function getSupabaseConfig() {
  return parseSupabaseConfig(
    {
      VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env
        .VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    {
      isDevelopment: import.meta.env.DEV,
    },
  )
}
