/**
 * Real Edge Function entry wiring, as an injectable factory.
 *
 * `index.ts` stays a thin production bootstrap that supplies Deno.env /
 * Deno.serve and the real Supabase client factory; this module contains the
 * full production wiring (environment reads, key selection, origin allowlist,
 * TTL configuration, client construction and handler assembly) with no Deno
 * or npm: imports, so CI can type-check `index.ts` with Deno AND run this
 * wiring against fakes without real network or secrets.
 */

import {
  createInviteWorkspaceMemberHandler,
  type InvitationStatus,
  type PreparedInvitation,
} from './handler.ts'
import { resolveVerifiedProviderTenant } from './verified-issuer.ts'

/** Default business invitation TTL; aligned with the Auth email OTP expiry. */
export const DEFAULT_INVITE_TTL_SECONDS = 3600
/** Safe lower bound for APP_INVITE_TTL_SECONDS (5 minutes). */
export const MIN_INVITE_TTL_SECONDS = 300
/** Safe upper bound for APP_INVITE_TTL_SECONDS (1 day). */
export const MAX_INVITE_TTL_SECONDS = 86400

export const INVITE_TTL_ENV_NAME = 'APP_INVITE_TTL_SECONDS'

export type EntryEnvironment = {
  get(name: string): string | undefined
}

export type EntryServe = (
  handler: (request: Request) => Promise<Response>,
) => void

type ClientOptions = {
  auth?: {
    persistSession?: boolean
    autoRefreshToken?: boolean
    detectSessionInUrl?: boolean
  }
  global?: { headers?: Record<string, string> }
}

/** Minimal structural client shapes used by the wiring (never the raw keys). */
export type CallerClientLike = {
  auth: {
    getUser(token: string): Promise<{
      data: { user: { id: string } | null } | null
      error: { status: number } | null
    }>
  }
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): Promise<{
    data: unknown
    error: { message: string } | null
  }>
}

export type AdminClientLike = {
  auth: {
    admin: {
      inviteUserByEmail(
        email: string,
        options: { redirectTo: string; data: Record<string, string> },
      ): Promise<{ error: { code?: string } | null }>
    }
  }
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): Promise<{
    data: unknown
    error: { message: string } | null
  }>
}

export type SupabaseClientFactory = (
  url: string,
  key: string,
  options: ClientOptions,
) => unknown

export type EntryDependencies = {
  env: EntryEnvironment
  serve: EntryServe
  createSupabaseClient: SupabaseClientFactory
  /** Local-development origins used when APP_ALLOWED_ORIGINS is not set. */
  allowedOriginsFallback?: ReadonlyArray<string>
}

const localOrigins = [
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]

/**
 * Read a named key: hosted platforms expose either a JSON object of named
 * keys (`SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS`) or a singular
 * legacy variable (`SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`).
 */
export function readNamedKey(
  env: EntryEnvironment,
  pluralName: string,
  singularName: string,
): string | null {
  const plural = env.get(pluralName)
  if (plural) {
    try {
      const parsed: unknown = JSON.parse(plural)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const values = Object.entries(parsed as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([, value]) => value)
          .filter(
            (value): value is string =>
              typeof value === 'string' && value !== '',
          )
        if (values[0]) return values[0]
      }
    } catch {
      return null
    }
  }
  return env.get(singularName) ?? null
}

export function configuredOrigins(
  env: EntryEnvironment,
  fallback: ReadonlyArray<string>,
): ReadonlySet<string> {
  const configured = env.get('APP_ALLOWED_ORIGINS')
  if (!configured) return new Set(fallback)

  const origins = configured
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '')
  const validated = origins.map((value) => {
    const url = new URL(value)
    if (url.origin !== value || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Invalid application origin configuration.')
    }
    return url.origin
  })
  if (validated.length === 0) {
    throw new Error('Application origins are not configured.')
  }
  return new Set(validated)
}

/**
 * Validate the invitation TTL configuration and refuse startup on any invalid
 * value. The trusted database boundary owns the actual expiry
 * (workspace_invitation_ttl_seconds()); this deployment-side check guarantees
 * the configured value stays inside the safe bounds AND stays aligned with the
 * Auth email OTP expiry (supabase/config.toml [auth] otp_expiry), so an
 * invite link can never outlive its OTP or silently use an overly long TTL.
 */
export function parseInviteTtlSeconds(env: EntryEnvironment): number {
  const raw = env.get(INVITE_TTL_ENV_NAME)
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_INVITE_TTL_SECONDS
  }
  const parsed = Number(raw)
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_INVITE_TTL_SECONDS ||
    parsed > MAX_INVITE_TTL_SECONDS
  ) {
    throw new Error('Invalid invitation TTL configuration.')
  }
  if (parsed !== DEFAULT_INVITE_TTL_SECONDS) {
    throw new Error(
      'Invitation TTL must match the Auth email OTP expiry; refusing startup.',
    )
  }
  return parsed
}

/**
 * Full production wiring. Throws when required configuration is missing or
 * invalid (refusing startup), then registers the assembled handler with the
 * provided `serve` function. The caller's Authorization is forwarded to the
 * low-privilege client; the admin client only ever holds the server secret.
 */
export function createInviteWorkspaceMemberEntry(
  dependencies: EntryDependencies,
): void {
  const { env, serve, createSupabaseClient } = dependencies

  const supabaseUrl = env.get('SUPABASE_URL')
  const publishableKey =
    readNamedKey(
      env,
      'SUPABASE_PUBLISHABLE_KEYS',
      'SUPABASE_PUBLISHABLE_KEY',
    ) ?? env.get('SUPABASE_ANON_KEY')
  const secretKey =
    readNamedKey(env, 'SUPABASE_SECRET_KEYS', 'SUPABASE_SECRET_KEY') ??
    env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !publishableKey || !secretKey) {
    throw new Error('Required Supabase server configuration is unavailable.')
  }

  // Fail-fast deployment check: the invitation TTL must stay inside the safe
  // bounds and aligned with the Auth email OTP expiry (see parseInviteTtlSeconds).
  parseInviteTtlSeconds(env)
  const trustedUrl = new URL(supabaseUrl)
  const adminClient = createSupabaseClient(supabaseUrl, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as AdminClientLike

  const callerClient = (authorization: string) =>
    createSupabaseClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }) as CallerClientLike

  const handler = createInviteWorkspaceMemberHandler({
    allowedOrigins: configuredOrigins(
      env,
      dependencies.allowedOriginsFallback ?? localOrigins,
    ),
    async authenticate(authorization) {
      const token = authorization.replace(/^Bearer\s+/i, '')
      const { data, error } =
        await callerClient(authorization).auth.getUser(token)
      if (error) {
        return {
          ok: false,
          code:
            error.status === 0 || error.status >= 500
              ? 'temporary_failure'
              : 'authorization_required',
        }
      }
      if (!data || !data.user) {
        return { ok: false, code: 'authorization_required' }
      }
      const providerTenant = resolveVerifiedProviderTenant({
        token,
        verifiedUserId: data.user.id,
        trustedSupabaseUrl: trustedUrl.href,
      })
      if (!providerTenant) {
        return { ok: false, code: 'authorization_required' }
      }
      return { ok: true, data: { providerTenant } }
    },
    async prepareInvitation(input, authorization) {
      const { data, error } = await callerClient(authorization).rpc(
        'prepare_workspace_invitation',
        {
          p_workspace_id: input.workspaceId,
          p_email_hash: input.emailHash,
          p_email_hint: input.emailHint,
          p_display_name: input.displayName,
          p_role: input.role,
          p_idempotency_key: input.idempotencyKey,
        },
      )
      if (error) return { ok: false, code: error.message } as const
      const row = Array.isArray(data) ? data[0] : null
      if (!row) return { ok: false, code: 'temporary_failure' } as const
      const status = (row as { invitation_status?: unknown })
        .invitation_status as InvitationStatus
      const operationKind = (row as { operation_kind?: unknown }).operation_kind
      const result: PreparedInvitation = {
        invitationId: String(
          (row as { invitation_id?: unknown }).invitation_id,
        ),
        status,
        shouldSend: Boolean((row as { should_send?: unknown }).should_send),
        operationKind:
          operationKind === 'existing_invitee_reissue'
            ? 'existing_invitee_reissue'
            : 'new_auth_user_invite',
      }
      return { ok: true, data: result } as const
    },
    async inviteAuthUser(input) {
      const { error } = await adminClient.auth.admin.inviteUserByEmail(
        input.email,
        {
          redirectTo: input.redirectTo,
          data: {
            ops_workspace_invitation_id: input.invitationId,
            ops_provider_tenant: input.providerTenant,
          },
        },
      )
      if (error) return { ok: false, code: error.code ?? 'auth_invite_failed' }
      return { ok: true, data: undefined }
    },
    async markInvitationFailed(invitationId, failureCategory) {
      const { error } = await adminClient.rpc(
        'mark_workspace_invitation_failed',
        {
          p_invitation_id: invitationId,
          p_failure_code: failureCategory,
        },
      )
      if (error) return { ok: false, code: 'temporary_failure' }
      return { ok: true, data: undefined }
    },
    async finalizeReissue(invitationId) {
      const { error } = await adminClient.rpc(
        'finalize_workspace_invitation_reissue',
        {
          p_invitation_id: invitationId,
        },
      )
      if (error) return { ok: false, code: 'temporary_failure' }
      return { ok: true, data: undefined }
    },
  })

  serve(handler)
}
