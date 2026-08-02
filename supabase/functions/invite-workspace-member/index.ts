import { createClient } from 'npm:@supabase/supabase-js@2.111.0'
import {
  createInviteWorkspaceMemberHandler,
  type EdgeOperationResult,
  type FailureCategory,
  type InvitationStatus,
  type PreparationInput,
  type PreparedInvitation,
} from './handler.ts'
import { resolveVerifiedProviderTenant } from './verified-issuer.ts'

type RuntimeEnvironment = {
  get(name: string): string | undefined
}

type DenoRuntime = {
  env: RuntimeEnvironment
  serve(handler: (request: Request) => Promise<Response>): void
}

declare const Deno: DenoRuntime

const localOrigins = [
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]

function readNamedKey(pluralName: string, singularName: string): string | null {
  const plural = Deno.env.get(pluralName)
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
  return Deno.env.get(singularName) ?? null
}

function configuredOrigins(): ReadonlySet<string> {
  const configured = Deno.env.get('APP_ALLOWED_ORIGINS')
  if (!configured) return new Set(localOrigins)

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

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const publishableKey =
  readNamedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_PUBLISHABLE_KEY') ??
  Deno.env.get('SUPABASE_ANON_KEY')
const secretKey =
  readNamedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SECRET_KEY') ??
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

if (!supabaseUrl || !publishableKey || !secretKey) {
  throw new Error('Required Supabase server configuration is unavailable.')
}

const trustedUrl = new URL(supabaseUrl)
const adminClient = createClient(supabaseUrl, secretKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})

function callerClient(authorization: string) {
  return createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

const handler = createInviteWorkspaceMemberHandler({
  allowedOrigins: configuredOrigins(),
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
    if (!data.user) {
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
        p_expires_at: input.expiresAt,
      },
    )
    if (error) return { ok: false, code: error.message } as const
    const row = Array.isArray(data) ? data[0] : null
    if (!row) return { ok: false, code: 'temporary_failure' } as const
    const status = row.invitation_status as InvitationStatus
    const result: PreparedInvitation = {
      invitationId: String(row.invitation_id),
      status,
      shouldSend: Boolean(row.should_send),
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
} satisfies {
  allowedOrigins: ReadonlySet<string>
  authenticate: (
    authorization: string,
  ) => Promise<EdgeOperationResult<{ providerTenant: string }>>
  prepareInvitation: (
    input: PreparationInput,
    authorization: string,
  ) => Promise<EdgeOperationResult<PreparedInvitation>>
  inviteAuthUser: (input: {
    email: string
    redirectTo: string
    invitationId: string
    providerTenant: string
  }) => Promise<EdgeOperationResult<undefined>>
  markInvitationFailed: (
    invitationId: string,
    failureCategory: FailureCategory,
  ) => Promise<EdgeOperationResult<undefined>>
})

Deno.serve(handler)
