import { createContext, useContext } from 'react'
import type { ProjectServiceResult } from '@/features/projects/projectService'
import type {
  Project,
  ProjectCreateInput,
  ProjectListInput,
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
}

export const ProjectContext = createContext<ProjectContextValue | null>(null)

export function useProjects(): ProjectContextValue {
  const context = useContext(ProjectContext)
  if (!context) {
    throw new Error('useProjects 必须在 ProjectProvider 内部使用。')
  }
  return context
}
