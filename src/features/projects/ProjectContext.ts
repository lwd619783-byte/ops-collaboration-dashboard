import { createContext, useContext } from 'react'
import type { ProjectServiceResult } from '@/features/projects/projectService'
import type {
  Project,
  ProjectClearLeadInput,
  ProjectCreateInput,
  ProjectLeadershipInput,
  ProjectListInput,
  ProjectMember,
  ProjectMemberCandidate,
  ProjectMemberInput,
  ProjectMemberRoleInput,
  ProjectModule,
  ProjectModuleInput,
  ProjectModuleNameInput,
  ProjectModuleRenameInput,
  ProjectModuleReorderInput,
  ProjectMutationResult,
  ProjectUpdateInput,
} from '@/features/projects/types'

export type ProjectContextValue = {
  list: (input: ProjectListInput) => Promise<ProjectServiceResult<Project[]>>
  get: (projectId: string) => Promise<ProjectServiceResult<Project>>
  create: (input: ProjectCreateInput) => Promise<ProjectServiceResult<Project>>
  update: (input: ProjectUpdateInput) => Promise<ProjectServiceResult<Project>>
  archive: (
    projectId: string,
    expectedUpdatedAt: string,
  ) => Promise<ProjectServiceResult<Project>>
  listMembers: (
    projectId: string,
  ) => Promise<ProjectServiceResult<ProjectMember[]>>
  listModules: (
    projectId: string,
  ) => Promise<ProjectServiceResult<ProjectModule[]>>
  addModule: (
    input: ProjectModuleNameInput,
  ) => Promise<ProjectServiceResult<ProjectModule[]>>
  renameModule: (
    input: ProjectModuleRenameInput,
  ) => Promise<ProjectServiceResult<ProjectModule[]>>
  reorderModules: (
    input: ProjectModuleReorderInput,
  ) => Promise<ProjectServiceResult<ProjectModule[]>>
  deleteModule: (
    input: ProjectModuleInput,
  ) => Promise<ProjectServiceResult<ProjectModule[]>>
  listMemberCandidates: (
    projectId: string,
  ) => Promise<ProjectServiceResult<ProjectMemberCandidate[]>>
  addMember: (
    input: ProjectMemberRoleInput,
  ) => Promise<ProjectServiceResult<ProjectMutationResult>>
  setMemberRole: (
    input: ProjectMemberRoleInput,
  ) => Promise<ProjectServiceResult<ProjectMutationResult>>
  removeMember: (
    input: ProjectMemberInput,
  ) => Promise<ProjectServiceResult<ProjectMutationResult>>
  setLead: (
    input: ProjectLeadershipInput,
  ) => Promise<ProjectServiceResult<ProjectMutationResult>>
  clearLead: (
    input: ProjectClearLeadInput,
  ) => Promise<ProjectServiceResult<ProjectMutationResult>>
  transferOwner: (
    input: ProjectLeadershipInput,
  ) => Promise<ProjectServiceResult<ProjectMutationResult>>
}

export const ProjectContext = createContext<ProjectContextValue | null>(null)

export function useProjects(): ProjectContextValue {
  const context = useContext(ProjectContext)
  if (!context) {
    throw new Error('useProjects 必须在 ProjectProvider 内部使用。')
  }
  return context
}
