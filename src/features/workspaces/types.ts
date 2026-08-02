import type { Database } from '@/types/database.generated'

export type WorkspaceRole = Database['public']['Enums']['workspace_role']
export type WorkspaceMemberStatus =
  Database['public']['Enums']['workspace_member_status']
export type WorkspaceInvitationStatus =
  Database['public']['Enums']['workspace_invitation_status']

export type WorkspaceSummary =
  Database['public']['Functions']['list_my_workspaces']['Returns'][number]

export type PendingWorkspaceInvitation =
  Database['public']['Functions']['list_my_pending_workspace_invitations']['Returns'][number]

type GeneratedWorkspaceMember =
  Database['public']['Functions']['list_workspace_members']['Returns'][number]

export type WorkspaceMember = Omit<
  GeneratedWorkspaceMember,
  'avatar_url' | 'organization_name' | 'title' | 'joined_at' | 'disabled_at'
> & {
  avatar_url: string | null
  organization_name: string | null
  title: string | null
  joined_at: string | null
  disabled_at: string | null
}

export type WorkspaceInvitationInput = {
  workspaceId: string
  email: string
  displayName: string
  role: Exclude<WorkspaceRole, 'owner'>
  idempotencyKey: string
}
