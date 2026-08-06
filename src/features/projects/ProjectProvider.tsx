import { useCallback, useMemo, type PropsWithChildren } from 'react'
import { createSafeProjectError } from '@/features/projects/errors'
import { ProjectContext } from '@/features/projects/ProjectContext'
import {
  addProjectMember,
  archiveProject,
  clearProjectLead,
  createProject,
  getProject,
  listProjectMemberCandidates,
  listProjectMembers,
  listProjects,
  removeProjectMember,
  setProjectLead,
  setProjectMemberRole,
  transferProjectOwner,
  updateProject,
  type ProjectServiceResult,
} from '@/features/projects/projectService'
import type { Project } from '@/features/projects/types'
import {
  getSupabaseClient,
  type SupabaseClientResolution,
} from '@/lib/supabase/client'

type ProjectProviderProps = PropsWithChildren<{
  resolveClient?: () => SupabaseClientResolution
}>

export function ProjectProvider({
  children,
  resolveClient = getSupabaseClient,
}: ProjectProviderProps) {
  const withClient = useCallback(
    <T,>(
      operation: (
        client: Extract<
          SupabaseClientResolution,
          { status: 'ready' }
        >['client'],
      ) => Promise<ProjectServiceResult<T>>,
    ): Promise<ProjectServiceResult<T>> => {
      const resolution = resolveClient()
      if (resolution.status !== 'ready') {
        return Promise.resolve({
          ok: false,
          error: createSafeProjectError('configuration_unavailable'),
        })
      }
      return operation(resolution.client)
    },
    [resolveClient],
  )

  const value = useMemo(
    () => ({
      list: (input: Parameters<typeof listProjects>[1]) =>
        withClient((client) => listProjects(client, input)),
      get: (projectId: string) =>
        withClient((client) => getProject(client, projectId)),
      create: (input: Parameters<typeof createProject>[1]) =>
        withClient((client) => createProject(client, input)),
      update: (input: Parameters<typeof updateProject>[1]) =>
        withClient((client) => updateProject(client, input)),
      archive: (projectId: string, expectedUpdatedAt: string) =>
        withClient<Project>((client) =>
          archiveProject(client, projectId, expectedUpdatedAt),
        ),
      listMembers: (projectId: string) =>
        withClient((client) => listProjectMembers(client, projectId)),
      listMemberCandidates: (projectId: string) =>
        withClient((client) => listProjectMemberCandidates(client, projectId)),
      addMember: (input: Parameters<typeof addProjectMember>[1]) =>
        withClient((client) => addProjectMember(client, input)),
      setMemberRole: (input: Parameters<typeof setProjectMemberRole>[1]) =>
        withClient((client) => setProjectMemberRole(client, input)),
      removeMember: (input: Parameters<typeof removeProjectMember>[1]) =>
        withClient((client) => removeProjectMember(client, input)),
      setLead: (input: Parameters<typeof setProjectLead>[1]) =>
        withClient((client) => setProjectLead(client, input)),
      clearLead: (input: Parameters<typeof clearProjectLead>[1]) =>
        withClient((client) => clearProjectLead(client, input)),
      transferOwner: (input: Parameters<typeof transferProjectOwner>[1]) =>
        withClient((client) => transferProjectOwner(client, input)),
    }),
    [withClient],
  )

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  )
}
