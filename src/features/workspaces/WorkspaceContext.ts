import { createContext, useContext } from 'react'
import type { SafeWorkspaceError } from '@/features/workspaces/errors'
import type { WorkspaceServiceResult } from '@/features/workspaces/workspaceService'
import type {
  PendingWorkspaceInvitation,
  WorkspaceInvitationInput,
  WorkspaceMember,
  WorkspaceMemberStatus,
  WorkspaceRole,
  WorkspaceSummary,
} from '@/features/workspaces/types'

export type WorkspaceLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export type WorkspaceContextValue = {
  status: WorkspaceLoadStatus
  workspaces: WorkspaceSummary[]
  currentWorkspace: WorkspaceSummary | null
  pendingInvitations: PendingWorkspaceInvitation[]
  error: SafeWorkspaceError | null
  refresh: () => Promise<void>
  listMembers: (
    workspaceId: string,
  ) => Promise<WorkspaceServiceResult<WorkspaceMember[]>>
  inviteMember: (
    input: WorkspaceInvitationInput,
  ) => Promise<WorkspaceServiceResult<undefined>>
  setMemberRole: (
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ) => Promise<WorkspaceServiceResult<undefined>>
  setMemberStatus: (
    workspaceId: string,
    userId: string,
    status: WorkspaceMemberStatus,
  ) => Promise<WorkspaceServiceResult<undefined>>
  acceptInvitation: (
    invitationId: string,
  ) => Promise<WorkspaceServiceResult<{ alreadyAccepted: boolean }>>
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(
  null,
)

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspace 必须在 WorkspaceProvider 内部使用。')
  }
  return context
}
