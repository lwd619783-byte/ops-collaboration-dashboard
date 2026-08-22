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
      /**
       * Present only for the exact `/activate-account` Auth callback handled
       * during this client's first initialization. Optional so controlled
       * test resolvers and non-browser callers keep their existing contract.
       */
      invitationCallback?: InvitationCallbackLifecycle
    }
  | {
      status: 'unavailable'
      reason: 'unconfigured' | 'invalid'
    }

export type InvitationCallbackLifecycle =
  | { status: 'none' }
  | { status: 'invalid' }
  | {
      status: 'pending'
      /** Reload once after auth-js persisted the invitee session. */
      reloadWithPkce: () => void
    }

type InvitationCallbackClassification =
  { status: 'none' } | { status: 'invalid' } | { status: 'valid' }

const ACTIVATION_CALLBACK_PATH = '/activate-account'
const invitationCallbackParameterNames = new Set([
  'access_token',
  'refresh_token',
  'expires_in',
  'expires_at',
  'token_type',
  'type',
  'error',
  'error_code',
  'error_description',
  'provider_token',
  'provider_refresh_token',
])
const invitationCallbackRequiredParameters = [
  'access_token',
  'refresh_token',
  'expires_in',
  'token_type',
] as const

/**
 * Recognize only the fragment shape emitted by a Supabase email invitation.
 * Query parameters, arbitrary routes and arbitrary `type` values can never
 * switch the client away from PKCE.
 */
export function classifyInvitationCallback(
  url: Pick<URL, 'hash' | 'pathname' | 'search'>,
): InvitationCallbackClassification {
  if (url.pathname !== ACTIVATION_CALLBACK_PATH) {
    return { status: 'none' }
  }

  const parameters = new URLSearchParams(url.hash.slice(1))
  const queryParameters = new URLSearchParams(url.search)
  const keys = [...parameters.keys()]
  const hasInvitationCallbackMarker = keys.some((key) =>
    invitationCallbackParameterNames.has(key),
  )
  const hasQueryCallbackMarker = [...queryParameters.keys()].some((key) =>
    invitationCallbackParameterNames.has(key),
  )
  if (!hasInvitationCallbackMarker) {
    return hasQueryCallbackMarker ? { status: 'invalid' } : { status: 'none' }
  }

  const hasUnexpectedParameter = keys.some(
    (key) => !invitationCallbackParameterNames.has(key),
  )
  const hasDuplicateParameter = keys.some(
    (key) => parameters.getAll(key).length !== 1,
  )
  const hasError = ['error', 'error_code', 'error_description'].some((key) =>
    parameters.has(key),
  )
  const hasOneNonEmptyValue = (key: string) => {
    const values = parameters.getAll(key)
    return values.length === 1 && values[0].length > 0
  }
  const expiresIn = Number(parameters.get('expires_in'))
  const expiresAt = parameters.get('expires_at')
  const hasValidExpiry =
    Number.isFinite(expiresIn) &&
    expiresIn > 0 &&
    (expiresAt === null ||
      (parameters.getAll('expires_at').length === 1 &&
        expiresAt.length > 0 &&
        Number.isFinite(Number(expiresAt)) &&
        Number(expiresAt) > 0))

  if (
    hasError ||
    hasUnexpectedParameter ||
    hasDuplicateParameter ||
    url.search.length > 0 ||
    parameters.get('type') !== 'invite' ||
    parameters.get('token_type')?.toLowerCase() !== 'bearer' ||
    !hasValidExpiry ||
    !invitationCallbackRequiredParameters.every(hasOneNonEmptyValue)
  ) {
    return { status: 'invalid' }
  }

  return { status: 'valid' }
}

function browserInvitationCallbackClassification(): InvitationCallbackClassification {
  if (typeof window === 'undefined') return { status: 'none' }
  return classifyInvitationCallback(window.location)
}

/** Replace the current history entry; never copy callback values elsewhere. */
function removeVisibleCallbackParameters() {
  if (
    typeof window === 'undefined' ||
    (window.location.hash.length === 0 && window.location.search.length === 0)
  ) {
    return
  }
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname,
  )
}

function createInvitationCallbackLifecycle(
  classification: InvitationCallbackClassification,
): InvitationCallbackLifecycle {
  if (classification.status === 'none') return { status: 'none' }
  if (classification.status === 'invalid') return { status: 'invalid' }

  let reloadStarted = false
  return {
    status: 'pending',
    reloadWithPkce: () => {
      if (reloadStarted || typeof window === 'undefined') return
      reloadStarted = true
      // The callback-specific client exists for one page lifetime only. A
      // reload creates the normal PKCE singleton from the persisted invitee
      // session, so recovery and every later auth action remain PKCE.
      window.history.replaceState(
        window.history.state,
        '',
        ACTIVATION_CALLBACK_PATH,
      )
      window.location.reload()
    },
  }
}

let cachedClient:
  | {
      config: SupabaseClientConfig
      client: SupabaseClient<Database>
      invitationCallback: InvitationCallbackLifecycle
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
    return {
      status: 'ready',
      client: cachedClient.client,
      invitationCallback: cachedClient.invitationCallback,
    }
  }

  const callbackClassification = browserInvitationCallbackClassification()

  // Invalid/expired/malformed callback fragments are removed before client
  // construction. The normal PKCE client can then recover an existing owner
  // session without interpreting or persisting any callback material.
  if (callbackClassification.status === 'invalid') {
    removeVisibleCallbackParameters()
  }

  // Admin invitations cannot use PKCE because the inviting and accepting
  // browsers differ. Use implicit only for the exact, fail-closed invitation
  // callback shape above; every other browser flow remains PKCE.
  const client = createClient<Database>(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      flowType: callbackClassification.status === 'valid' ? 'implicit' : 'pkce',
    },
  })

  // auth-js 2.111.0 captures the callback parameters synchronously when the
  // client is constructed, before its user validation request awaits. Replace
  // the current history entry immediately so secrets are never copied to a
  // query/returnTo and do not remain visible while initialization completes.
  if (callbackClassification.status === 'valid') {
    removeVisibleCallbackParameters()
  }

  const invitationCallback = createInvitationCallbackLifecycle(
    callbackClassification,
  )
  cachedClient = { config, client, invitationCallback }
  return { status: 'ready', client, invitationCallback }
}

export function resetSupabaseClientForTests() {
  cachedClient = undefined
}
