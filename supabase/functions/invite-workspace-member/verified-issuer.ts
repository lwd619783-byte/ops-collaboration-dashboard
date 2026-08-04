export type VerifiedProviderTenantInput = {
  token: string
  verifiedUserId: string
  trustedSupabaseUrl: string
}

export function resolveVerifiedProviderTenant({
  token,
  verifiedUserId,
  trustedSupabaseUrl,
}: VerifiedProviderTenantInput): string | null {
  try {
    const trustedUrl = new URL(trustedSupabaseUrl)
    const parts = token.split('.')
    if (parts.length !== 3 || !parts[1]) return null
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const decoded = atob(padded)
    const bytes = Uint8Array.from(decoded, (character) =>
      character.charCodeAt(0),
    )
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
      return null
    }
    const { iss, sub } = claims as Record<string, unknown>
    if (
      typeof iss !== 'string' ||
      iss.length > 2048 ||
      typeof sub !== 'string' ||
      sub !== verifiedUserId
    ) {
      return null
    }

    const issuer = new URL(iss)
    if (
      issuer.pathname !== '/auth/v1' ||
      issuer.search !== '' ||
      issuer.hash !== '' ||
      issuer.username !== '' ||
      issuer.password !== ''
    ) {
      return null
    }

    const expected = `${trustedUrl.origin}/auth/v1`
    if (issuer.href.replace(/\/$/u, '') === expected) return expected

    // The local Edge Runtime receives an internal Kong URL while Auth issues
    // tokens for the external loopback API URL. The token must be verified by
    // auth.getUser before this helper is called; this exception is loopback-only.
    const internalRuntimeHosts = new Set(['kong', 'host.docker.internal'])
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
    if (
      internalRuntimeHosts.has(trustedUrl.hostname) &&
      issuer.protocol === 'http:' &&
      loopbackHosts.has(issuer.hostname)
    ) {
      return issuer.href.replace(/\/$/u, '')
    }
  } catch {
    return null
  }
  return null
}
