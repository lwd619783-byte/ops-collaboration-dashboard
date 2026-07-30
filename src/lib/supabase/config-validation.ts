export const forbiddenSupabaseFrontendEnvironmentNames = [
  'VITE_SUPABASE_SECRET_KEY',
  'VITE_SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_DB_URL',
  'VITE_DATABASE_URL',
  'VITE_DATABASE_PASSWORD',
  'VITE_SUPABASE_DATABASE_PASSWORD',
  'VITE_SUPABASE_JWT_SECRET',
] as const

type ForbiddenSupabaseFrontendEnvironmentName =
  (typeof forbiddenSupabaseFrontendEnvironmentNames)[number]

export type SupabaseEnvironment = Partial<
  Record<
    | 'VITE_SUPABASE_URL'
    | 'VITE_SUPABASE_PUBLISHABLE_KEY'
    | ForbiddenSupabaseFrontendEnvironmentName,
    string
  >
>

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

type ParseOptions = {
  isDevelopment: boolean
}

const invalidConfigMessage = '检测到不安全或无效的 Supabase 前端配置。'
const base64UrlAlphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function invalidConfig(): SupabaseConfigResult {
  return { status: 'invalid', message: invalidConfigMessage }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function decodeBase64Url(value: string) {
  if (
    value.length === 0 ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return undefined
  }

  const bytes: number[] = []
  let buffer = 0
  let bitCount = 0

  for (const character of value) {
    const characterValue = base64UrlAlphabet.indexOf(character)
    if (characterValue < 0) return undefined

    buffer = (buffer << 6) | characterValue
    bitCount += 6
    if (bitCount >= 8) {
      bitCount -= 8
      bytes.push((buffer >> bitCount) & 0xff)
      buffer &= (1 << bitCount) - 1
    }
  }

  return new Uint8Array(bytes)
}

function decodeJwtRole(token: string) {
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return undefined
  }

  const payloadBytes = decodeBase64Url(parts[1])
  if (!payloadBytes) return undefined

  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(payloadBytes))
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
  if (
    forbiddenSupabaseFrontendEnvironmentNames.some((name) =>
      environment[name]?.trim(),
    )
  ) {
    return invalidConfig()
  }

  const rawUrl = environment.VITE_SUPABASE_URL?.trim()
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  const missing: Array<'url' | 'publishableKey'> = []

  if (!rawUrl) missing.push('url')
  if (!publishableKey) missing.push('publishableKey')
  if (missing.length === 2) {
    return { status: 'unconfigured', missing }
  }
  if (missing.length > 0 || !rawUrl || !publishableKey) {
    return invalidConfig()
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return invalidConfig()
  }

  const isLocalUrl = isLocalHostname(url.hostname)
  const usesHttps = url.protocol === 'https:'
  const usesAllowedLocalHttp =
    options.isDevelopment && isLocalUrl && url.protocol === 'http:'

  if (!usesHttps && !usesAllowedLocalHttp) {
    return invalidConfig()
  }

  if (
    !validatePublishableKey(publishableKey, options.isDevelopment, isLocalUrl)
  ) {
    return invalidConfig()
  }

  return {
    status: 'configured',
    config: {
      url: url.toString().replace(/\/$/, ''),
      publishableKey,
    },
  }
}
