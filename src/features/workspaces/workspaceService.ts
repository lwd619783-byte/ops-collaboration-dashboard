import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.generated'
import {
  createSafeWorkspaceError,
  isSafeWorkspaceErrorPayload,
  mapWorkspaceError,
  type SafeWorkspaceError,
} from '@/features/workspaces/errors'
import type {
  PendingWorkspaceInvitation,
  WorkspaceInvitationInput,
  WorkspaceMember,
  WorkspaceMemberStatus,
  WorkspaceRole,
  WorkspaceSummary,
} from '@/features/workspaces/types'

export type WorkspaceServiceResult<T> =
  { ok: true; data: T } | { ok: false; error: SafeWorkspaceError }

export async function listMyWorkspaces(
  client: SupabaseClient<Database>,
): Promise<WorkspaceServiceResult<WorkspaceSummary[]>> {
  try {
    const { data, error } = await client.rpc('list_my_workspaces')
    if (error) return { ok: false, error: mapWorkspaceError(error) }
    return { ok: true, data: data ?? [] }
  } catch (error) {
    return { ok: false, error: mapWorkspaceError(error) }
  }
}

export async function listMyPendingWorkspaceInvitations(
  client: SupabaseClient<Database>,
): Promise<WorkspaceServiceResult<PendingWorkspaceInvitation[]>> {
  try {
    const { data, error } = await client.rpc(
      'list_my_pending_workspace_invitations',
    )
    if (error) return { ok: false, error: mapWorkspaceError(error) }
    return { ok: true, data: data ?? [] }
  } catch (error) {
    return { ok: false, error: mapWorkspaceError(error) }
  }
}

export async function listWorkspaceMembers(
  client: SupabaseClient<Database>,
  workspaceId: string,
): Promise<WorkspaceServiceResult<WorkspaceMember[]>> {
  try {
    const { data, error } = await client.rpc('list_workspace_members', {
      p_workspace_id: workspaceId,
    })
    if (error) return { ok: false, error: mapWorkspaceError(error) }
    return { ok: true, data: (data ?? []) as WorkspaceMember[] }
  } catch (error) {
    return { ok: false, error: mapWorkspaceError(error) }
  }
}

export async function setWorkspaceMemberRole(
  client: SupabaseClient<Database>,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<WorkspaceServiceResult<undefined>> {
  try {
    const { data, error } = await client.rpc('set_workspace_member_role', {
      p_workspace_id: workspaceId,
      p_user_id: userId,
      p_role: role,
    })
    if (error) return { ok: false, error: mapWorkspaceError(error) }
    if (!data?.[0]) {
      return {
        ok: false,
        error: createSafeWorkspaceError('member_not_found'),
      }
    }
    return { ok: true, data: undefined }
  } catch (error) {
    return { ok: false, error: mapWorkspaceError(error) }
  }
}

export async function setWorkspaceMemberStatus(
  client: SupabaseClient<Database>,
  workspaceId: string,
  userId: string,
  status: WorkspaceMemberStatus,
): Promise<WorkspaceServiceResult<undefined>> {
  try {
    const { data, error } = await client.rpc('set_workspace_member_status', {
      p_workspace_id: workspaceId,
      p_user_id: userId,
      p_status: status,
    })
    if (error) return { ok: false, error: mapWorkspaceError(error) }
    if (!data?.[0]) {
      return {
        ok: false,
        error: createSafeWorkspaceError('member_not_found'),
      }
    }
    return { ok: true, data: undefined }
  } catch (error) {
    return { ok: false, error: mapWorkspaceError(error) }
  }
}

async function mapFunctionInvocationError(
  error: unknown,
): Promise<SafeWorkspaceError> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      try {
        const payload: unknown = await context.clone().json()
        if (isSafeWorkspaceErrorPayload(payload)) {
          return mapWorkspaceError({ code: payload.error.code })
        }
      } catch {
        // Ignore unreadable response bodies; the fixed fallback below is safe.
      }
    }
  }
  return mapWorkspaceError(error)
}

export async function inviteWorkspaceMember(
  client: SupabaseClient<Database>,
  input: WorkspaceInvitationInput,
): Promise<WorkspaceServiceResult<undefined>> {
  try {
    const { error } = await client.functions.invoke('invite-workspace-member', {
      body: input,
    })
    if (error) {
      return { ok: false, error: await mapFunctionInvocationError(error) }
    }
    return { ok: true, data: undefined }
  } catch (error) {
    return { ok: false, error: mapWorkspaceError(error) }
  }
}

export async function acceptWorkspaceInvitation(
  client: SupabaseClient<Database>,
  invitationId: string,
): Promise<WorkspaceServiceResult<{ alreadyAccepted: boolean }>> {
  try {
    const { data, error } = await client.rpc('accept_workspace_invitation', {
      p_invitation_id: invitationId,
    })
    if (error) return { ok: false, error: mapWorkspaceError(error) }
    const row = data?.[0]
    if (!row) {
      return {
        ok: false,
        error: createSafeWorkspaceError('invitation_unavailable'),
      }
    }
    return {
      ok: true,
      data: { alreadyAccepted: row.already_accepted },
    }
  } catch (error) {
    return { ok: false, error: mapWorkspaceError(error) }
  }
}
