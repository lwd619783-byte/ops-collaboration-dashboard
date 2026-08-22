import { describe, expect, it, vi } from 'vitest'
import type {
  AuthError,
  Session,
  SupabaseClient,
  User,
} from '@supabase/supabase-js'
import { createPendingInvitationCallbackLifecycle } from '@/features/auth/invitationCallback'
import type { Database } from '@/types/database.generated'

const OWNER_ID = '22222222-2222-4222-8222-222222222222'
const INCOMING_ID = '11111111-1111-4111-8111-111111111111'

function fixtureUser(id: string): User {
  return {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'synthetic-user@example.invalid',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: '2026-08-22T00:00:00.000Z',
  }
}

function fixtureSession(id: string, prefix: string): Session {
  return {
    access_token: `${prefix}.synthetic.access`,
    refresh_token: `${prefix}.synthetic.refresh`,
    expires_in: 3600,
    expires_at: 4102444800,
    token_type: 'bearer',
    user: fixtureUser(id),
  }
}

function createHarness({
  currentSession,
  pendingInvitation,
  initializationError = null,
}: {
  currentSession: Session | null
  pendingInvitation: boolean
  initializationError?: unknown
}) {
  const incomingSession = fixtureSession(INCOMING_ID, 'incoming')
  const authenticatedSession = fixtureSession(INCOMING_ID, 'rotated')
  let persistentSession = currentSession
  const persistentBroadcast = vi.fn()
  const dispose = vi.fn(async () => undefined)
  const refreshSession = vi.fn(async () => ({
    data: { session: authenticatedSession, user: authenticatedSession.user },
    error: null,
  }))
  const rpc = vi.fn(async (name: string) => {
    if (name !== 'list_my_pending_workspace_invitations') {
      throw new Error('Unexpected synthetic RPC')
    }
    return {
      data: pendingInvitation
        ? [
            {
              invitation_id: '33333333-3333-4333-8333-333333333333',
              workspace_id: '44444444-4444-4444-8444-444444444444',
              workspace_name: 'Synthetic Workspace',
              role: 'member' as const,
              status: 'sent' as const,
              expires_at: '2099-01-01T00:00:00.000Z',
            },
          ]
        : [],
      error: null,
    }
  })
  const callbackClient = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: incomingSession },
        error: null,
      })),
      getUser: vi.fn(async () => ({
        data: { user: incomingSession.user },
        error: null,
      })),
      refreshSession,
      dispose,
    },
    rpc,
  } as unknown as SupabaseClient<Database>
  const getPersistentSession = vi.fn(async () => ({
    data: { session: persistentSession },
    error: null,
  }))
  const setSession = vi.fn(async () => {
    persistentSession = authenticatedSession
    persistentBroadcast('SIGNED_IN', authenticatedSession.user.id)
    return {
      data: {
        session: authenticatedSession,
        user: authenticatedSession.user,
      },
      error: null,
    }
  })
  const persistentClient = {
    auth: {
      getSession: getPersistentSession,
      setSession,
    },
  } as unknown as SupabaseClient<Database>
  const reloadWithPkce = vi.fn()
  const lifecycle = createPendingInvitationCallbackLifecycle({
    callbackClient,
    callbackInitialization: Promise.resolve({
      error: initializationError as AuthError | null,
    }),
    persistentClient,
    reloadWithPkce,
  })
  if (lifecycle.status !== 'pending') {
    throw new Error('Synthetic lifecycle was not pending')
  }

  return {
    lifecycle,
    incomingSession,
    authenticatedSession,
    rpc,
    dispose,
    refreshSession,
    getPersistentSession,
    setSession,
    persistentBroadcast,
    persistentSession: () => persistentSession,
  }
}

describe('invitation callback authenticity and persistent handoff', () => {
  it('ATTACK A: owner + forged valid normal-user session without invitation is rejected before persistence', async () => {
    const ownerSession = fixtureSession(OWNER_ID, 'owner')
    const harness = createHarness({
      currentSession: ownerSession,
      pendingInvitation: false,
    })

    const result = await harness.lifecycle.authenticateAndHandoff()

    expect(result).toEqual({
      status: 'error',
      reason: 'invitation_not_eligible',
    })
    expect(harness.rpc).toHaveBeenCalledWith(
      'list_my_pending_workspace_invitations',
    )
    expect(harness.refreshSession).toHaveBeenCalledTimes(1)
    expect(harness.getPersistentSession).toHaveBeenCalledTimes(1)
    expect(harness.setSession).not.toHaveBeenCalled()
    expect(harness.persistentBroadcast).not.toHaveBeenCalled()
    expect(harness.persistentSession()?.user.id).toBe(OWNER_ID)
    expect(harness.dispose).toHaveBeenCalledTimes(1)
  })

  it('ATTACK B: clean browser + forged valid normal-user session is not persisted or authorized', async () => {
    const harness = createHarness({
      currentSession: null,
      pendingInvitation: false,
    })

    const result = await harness.lifecycle.authenticateAndHandoff()

    expect(result).toEqual({
      status: 'error',
      reason: 'invitation_not_eligible',
    })
    expect(harness.setSession).not.toHaveBeenCalled()
    expect(harness.persistentBroadcast).not.toHaveBeenCalled()
    expect(harness.persistentSession()).toBeNull()
    expect(harness.getPersistentSession).toHaveBeenCalledTimes(1)
  })

  it('ATTACK C: owner + eligible different invitee fails closed without a cross-tab sign-in', async () => {
    const ownerSession = fixtureSession(OWNER_ID, 'owner')
    const harness = createHarness({
      currentSession: ownerSession,
      pendingInvitation: true,
    })

    const result = await harness.lifecycle.authenticateAndHandoff()

    expect(result).toEqual({ status: 'error', reason: 'session_conflict' })
    expect(harness.getPersistentSession).toHaveBeenCalledTimes(2)
    expect(harness.setSession).not.toHaveBeenCalled()
    expect(harness.persistentBroadcast).not.toHaveBeenCalled()
    expect(harness.persistentSession()?.user.id).toBe(OWNER_ID)
  })

  it('cross-tab owner appearing during eligibility is caught by the pre-handoff recheck', async () => {
    const harness = createHarness({
      currentSession: null,
      pendingInvitation: true,
    })
    harness.getPersistentSession
      .mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValueOnce({
        data: { session: fixtureSession(OWNER_ID, 'cross-tab-owner') },
        error: null,
      })

    const result = await harness.lifecycle.authenticateAndHandoff()

    expect(result).toEqual({ status: 'error', reason: 'session_conflict' })
    expect(harness.getPersistentSession).toHaveBeenCalledTimes(2)
    expect(harness.setSession).not.toHaveBeenCalled()
    expect(harness.persistentBroadcast).not.toHaveBeenCalled()
  })

  it('ATTACK D: clean browser + eligible invitee performs one official persistent handoff', async () => {
    const harness = createHarness({
      currentSession: null,
      pendingInvitation: true,
    })

    const first = harness.lifecycle.authenticateAndHandoff()
    const second = harness.lifecycle.authenticateAndHandoff()
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(second).toBe(first)
    expect(firstResult).toEqual({ status: 'persistent_handoff_completed' })
    expect(secondResult).toEqual(firstResult)
    expect(harness.setSession).toHaveBeenCalledTimes(1)
    expect(harness.getPersistentSession).toHaveBeenCalledTimes(2)
    expect(harness.setSession).toHaveBeenCalledWith({
      access_token: harness.authenticatedSession.access_token,
      refresh_token: harness.authenticatedSession.refresh_token,
    })
    expect(harness.setSession).not.toHaveBeenCalledWith({
      access_token: harness.incomingSession.access_token,
      refresh_token: harness.incomingSession.refresh_token,
    })
    expect(harness.persistentSession()?.user.id).toBe(INCOMING_ID)
    expect(harness.persistentBroadcast).toHaveBeenCalledTimes(1)
    expect(harness.dispose).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(firstResult)).not.toContain('synthetic.access')
    expect(JSON.stringify(firstResult)).not.toContain('synthetic.refresh')
  })

  it('ATTACK E: same invitee already persistent uses deterministic idempotent handoff', async () => {
    const harness = createHarness({
      currentSession: fixtureSession(INCOMING_ID, 'existing-invitee'),
      pendingInvitation: true,
    })

    const result = await harness.lifecycle.authenticateAndHandoff()

    expect(result).toEqual({ status: 'persistent_handoff_completed' })
    expect(harness.getPersistentSession).toHaveBeenCalledTimes(2)
    expect(harness.setSession).toHaveBeenCalledTimes(1)
    expect(harness.persistentSession()?.user.id).toBe(INCOMING_ID)
    expect(harness.persistentBroadcast).toHaveBeenCalledTimes(1)
  })

  it('callback auth failure is deterministic and never reaches eligibility or persistence', async () => {
    const harness = createHarness({
      currentSession: fixtureSession(OWNER_ID, 'owner'),
      pendingInvitation: true,
      initializationError: { name: 'SyntheticAuthError' },
    })

    const result = await harness.lifecycle.authenticateAndHandoff()

    expect(result).toEqual({ status: 'error', reason: 'callback_auth_failed' })
    expect(harness.rpc).not.toHaveBeenCalled()
    expect(harness.refreshSession).not.toHaveBeenCalled()
    expect(harness.getPersistentSession).not.toHaveBeenCalled()
    expect(harness.setSession).not.toHaveBeenCalled()
    expect(harness.persistentBroadcast).not.toHaveBeenCalled()
    expect(harness.persistentSession()?.user.id).toBe(OWNER_ID)
  })
})
