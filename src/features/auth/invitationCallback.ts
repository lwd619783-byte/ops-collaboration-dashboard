import type { SupabaseClient } from '@supabase/supabase-js'
import { listMyPendingWorkspaceInvitations } from '@/features/workspaces/workspaceService'
import type { PendingWorkspaceInvitation } from '@/features/workspaces/types'
import type { Database } from '@/types/database.generated'

export type InvitationCallbackErrorReason =
  | 'malformed_or_expired'
  | 'invitation_not_eligible'
  | 'session_conflict'
  | 'callback_auth_failed'

export type InvitationCallbackHandoffResult =
  | { status: 'persistent_handoff_completed' }
  | { status: 'error'; reason: InvitationCallbackErrorReason }

export type InvitationCallbackLifecycle =
  | { status: 'none' }
  | { status: 'invalid' }
  | {
      status: 'pending'
      authenticateAndHandoff: () => Promise<InvitationCallbackHandoffResult>
      reloadWithPkce: () => void
    }

type AuthInitialization = Awaited<
  ReturnType<SupabaseClient<Database>['auth']['initialize']>
>

type PendingInvitationCallbackOptions = {
  callbackClient: SupabaseClient<Database>
  callbackInitialization: Promise<AuthInitialization>
  persistentClient: SupabaseClient<Database>
  reloadWithPkce: () => void
}

function hasServerConfirmedPendingInvitation(
  invitations: PendingWorkspaceInvitation[],
) {
  const now = Date.now()
  return invitations.some(
    (invitation) =>
      invitation.status === 'sent' &&
      Number.isFinite(Date.parse(invitation.expires_at)) &&
      Date.parse(invitation.expires_at) > now,
  )
}

/**
 * Authenticate and authorize an implicit invitation callback without exposing
 * its session to the application auth state. The callback client is owned by
 * this closure and disposed at every terminal outcome; no token is returned.
 */
export function createPendingInvitationCallbackLifecycle({
  callbackClient: initialCallbackClient,
  callbackInitialization: initialCallbackInitialization,
  persistentClient,
  reloadWithPkce,
}: PendingInvitationCallbackOptions): InvitationCallbackLifecycle {
  let callbackClient: SupabaseClient<Database> | undefined =
    initialCallbackClient
  let callbackInitialization: Promise<AuthInitialization> | undefined =
    initialCallbackInitialization
  let handoffPromise: Promise<InvitationCallbackHandoffResult> | undefined

  const disposeCallbackClient = async () => {
    const client = callbackClient
    callbackClient = undefined
    callbackInitialization = undefined
    if (client) {
      try {
        await client.auth.dispose()
      } catch {
        // Cleanup must never replace the fixed, token-free terminal outcome.
      }
    }
  }

  const fail = async (
    reason: InvitationCallbackErrorReason,
  ): Promise<InvitationCallbackHandoffResult> => {
    await disposeCallbackClient()
    return { status: 'error', reason }
  }

  const authenticateAndHandoff = () => {
    if (handoffPromise) return handoffPromise

    handoffPromise = (async (): Promise<InvitationCallbackHandoffResult> => {
      const ephemeralClient = callbackClient
      const initialization = callbackInitialization
      if (!ephemeralClient || !initialization) {
        return fail('callback_auth_failed')
      }

      try {
        const initializationResult = await initialization
        if (initializationResult.error) {
          return fail('callback_auth_failed')
        }

        const incomingSessionResult = await ephemeralClient.auth.getSession()
        const incomingSession = incomingSessionResult.data.session
        if (incomingSessionResult.error || !incomingSession) {
          return fail('callback_auth_failed')
        }

        // getUser() performs an Auth-server request. URL `type=invite` remains
        // only a routing hint and is never treated as authentication evidence.
        const authenticatedUserResult = await ephemeralClient.auth.getUser(
          incomingSession.access_token,
        )
        const authenticatedUser = authenticatedUserResult.data.user
        if (
          authenticatedUserResult.error ||
          !authenticatedUser ||
          authenticatedUser.id !== incomingSession.user.id
        ) {
          return fail('callback_auth_failed')
        }

        // The implicit URL parser authenticates the access token but does not
        // prove that the supplied refresh token belongs to the same identity.
        // Rotate it inside the memory-only client before eligibility, then use
        // only the server-returned pair for the eventual handoff.
        const refreshedSessionResult =
          await ephemeralClient.auth.refreshSession({
            refresh_token: incomingSession.refresh_token,
          })
        const authenticatedSession = refreshedSessionResult.data.session
        if (
          refreshedSessionResult.error ||
          !authenticatedSession ||
          !refreshedSessionResult.data.user ||
          authenticatedSession.user.id !== authenticatedUser.id ||
          refreshedSessionResult.data.user.id !== authenticatedUser.id
        ) {
          return fail('callback_auth_failed')
        }

        // Snapshot the normal persistent PKCE session without mutating it. The
        // conflict decision remains deferred until server eligibility passes,
        // so an ineligible forged callback gets only the generic safe outcome.
        const currentSessionResult = await persistentClient.auth.getSession()
        if (currentSessionResult.error) return fail('callback_auth_failed')
        const currentSession = currentSessionResult.data.session

        // This RPC has no user-id argument. It resolves the caller through
        // current_app_user_id() and returns only sent, unexpired invitations.
        const eligibility =
          await listMyPendingWorkspaceInvitations(ephemeralClient)
        if (!eligibility.ok) return fail('callback_auth_failed')
        if (!hasServerConfirmedPendingInvitation(eligibility.data)) {
          return fail('invitation_not_eligible')
        }

        // Re-read after the server round trip to catch a cross-tab session
        // change during eligibility. A different identity in either snapshot
        // is never overwritten.
        const latestSessionResult = await persistentClient.auth.getSession()
        if (latestSessionResult.error) return fail('callback_auth_failed')
        const latestSession = latestSessionResult.data.session
        if (
          (currentSession && currentSession.user.id !== authenticatedUser.id) ||
          (latestSession && latestSession.user.id !== authenticatedUser.id)
        ) {
          return fail('session_conflict')
        }

        // Official public handoff API. auth-js authenticates the access token
        // again before its persistent save and normal cross-tab SIGNED_IN.
        const handoff = await persistentClient.auth.setSession({
          access_token: authenticatedSession.access_token,
          refresh_token: authenticatedSession.refresh_token,
        })
        if (
          handoff.error ||
          !handoff.data.session ||
          !handoff.data.user ||
          handoff.data.session.user.id !== authenticatedUser.id ||
          handoff.data.user.id !== authenticatedUser.id
        ) {
          return fail('callback_auth_failed')
        }

        await disposeCallbackClient()
        return { status: 'persistent_handoff_completed' }
      } catch {
        return fail('callback_auth_failed')
      }
    })()

    return handoffPromise
  }

  return {
    status: 'pending',
    authenticateAndHandoff,
    reloadWithPkce,
  }
}
