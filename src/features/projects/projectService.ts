import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.generated'
import {
  createSafeProjectError,
  mapProjectError,
  type SafeProjectError,
} from '@/features/projects/errors'
import {
  isProjectRole,
  isProjectStatus,
  isProjectType,
  isProjectWorkspaceRole,
} from '@/features/projects/projectMeta'
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
  ProjectMutationResult,
  ProjectUpdateInput,
} from '@/features/projects/types'

export type ProjectServiceResult<T> =
  { ok: true; data: T } | { ok: false; error: SafeProjectError }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value)
}

function parseProject(value: unknown): Project | null {
  if (!isRecord(value)) return null
  if (
    !isString(value.project_id) ||
    !isString(value.workspace_id) ||
    !isString(value.name) ||
    !isNullableString(value.description) ||
    !isProjectType(value.project_type) ||
    !isProjectStatus(value.status) ||
    !isString(value.owner_id) ||
    !isString(value.owner_display_name) ||
    !isNullableString(value.lead_id) ||
    !isNullableString(value.lead_display_name) ||
    !isString(value.created_by) ||
    !isNullableString(value.start_date) ||
    !isNullableString(value.due_date) ||
    !isString(value.created_at) ||
    !isString(value.updated_at) ||
    !isNullableString(value.archived_at)
  ) {
    return null
  }
  return value as unknown as Project
}

function invalidPayload<T>(): ProjectServiceResult<T> {
  return {
    ok: false,
    error: createSafeProjectError('unknown_service_error'),
  }
}

function parseProjectArray(value: unknown): ProjectServiceResult<Project[]> {
  if (!Array.isArray(value)) return invalidPayload()
  const projects = value.map(parseProject)
  if (projects.some((project) => project === null)) return invalidPayload()
  return { ok: true, data: projects as Project[] }
}

function firstProject(rows: unknown): ProjectServiceResult<Project> {
  if (!Array.isArray(rows)) return invalidPayload()
  const row = rows[0]
  if (!row) {
    return {
      ok: false,
      error: createSafeProjectError('not_found_or_forbidden'),
    }
  }
  const project = parseProject(row)
  return project ? { ok: true, data: project } : invalidPayload()
}

function firstProjectMutation(
  rows: unknown,
): ProjectServiceResult<ProjectMutationResult> {
  if (!Array.isArray(rows)) return invalidPayload()
  const row = rows[0]
  if (!isRecord(row) || typeof row.changed !== 'boolean') {
    return invalidPayload()
  }
  const project = parseProject(row)
  return project
    ? { ok: true, data: { ...project, changed: row.changed } }
    : invalidPayload()
}

function parseProjectMember(value: unknown): ProjectMember | null {
  if (!isRecord(value)) return null
  if (
    !isString(value.project_id) ||
    !isString(value.workspace_id) ||
    !isString(value.app_user_id) ||
    !isString(value.display_name) ||
    !isProjectRole(value.project_role) ||
    !isProjectWorkspaceRole(value.workspace_role) ||
    !isString(value.joined_at) ||
    typeof value.is_current_user !== 'boolean' ||
    typeof value.is_active !== 'boolean' ||
    typeof value.active_member_count !== 'number' ||
    typeof value.inactive_historical_member_count !== 'number'
  ) {
    return null
  }
  return value as unknown as ProjectMember
}

function parseProjectCandidate(value: unknown): ProjectMemberCandidate | null {
  if (!isRecord(value)) return null
  if (
    !isString(value.project_id) ||
    !isString(value.workspace_id) ||
    !isString(value.app_user_id) ||
    !isString(value.display_name) ||
    !isProjectWorkspaceRole(value.workspace_role) ||
    (value.existing_project_role !== null &&
      !isProjectRole(value.existing_project_role))
  ) {
    return null
  }
  return value as unknown as ProjectMemberCandidate
}

function parseRows<T>(
  value: unknown,
  parser: (row: unknown) => T | null,
): ProjectServiceResult<T[]> {
  if (!Array.isArray(value)) return invalidPayload()
  const rows = value.map(parser)
  if (rows.some((row) => row === null)) return invalidPayload()
  return { ok: true, data: rows as T[] }
}

export async function listProjects(
  client: SupabaseClient<Database>,
  input: ProjectListInput,
): Promise<ProjectServiceResult<Project[]>> {
  const args: Database['public']['Functions']['list_projects']['Args'] = {
    p_workspace_id: input.workspaceId,
    p_archived_only: input.archivedOnly ?? false,
  }
  if (input.status) args.p_status = input.status
  if (input.search?.trim()) args.p_search = input.search.trim()

  try {
    const { data, error } = await client.rpc('list_projects', args)
    if (error) return { ok: false, error: mapProjectError(error) }
    return parseProjectArray(data)
  } catch (error) {
    return { ok: false, error: mapProjectError(error) }
  }
}

export async function getProject(
  client: SupabaseClient<Database>,
  projectId: string,
): Promise<ProjectServiceResult<Project>> {
  try {
    const { data, error } = await client.rpc('get_project', {
      p_project_id: projectId,
    })
    if (error) return { ok: false, error: mapProjectError(error) }
    return firstProject(data)
  } catch (error) {
    return { ok: false, error: mapProjectError(error) }
  }
}

type NullableCreateArgs = Omit<
  Database['public']['Functions']['create_project']['Args'],
  'p_description' | 'p_due_date' | 'p_start_date'
> & {
  p_description: string | null
  p_due_date: string | null
  p_start_date: string | null
}

export async function createProject(
  client: SupabaseClient<Database>,
  input: ProjectCreateInput,
): Promise<ProjectServiceResult<Project>> {
  const nullableArgs: NullableCreateArgs = {
    p_workspace_id: input.workspaceId,
    p_name: input.name,
    p_description: input.description.trim() || null,
    p_project_type: input.projectType,
    p_initial_status: input.initialStatus,
    p_start_date: input.startDate,
    p_due_date: input.dueDate,
    p_idempotency_key: input.idempotencyKey,
  }
  try {
    const { data, error } = await client.rpc(
      'create_project',
      nullableArgs as unknown as Database['public']['Functions']['create_project']['Args'],
    )
    if (error) return { ok: false, error: mapProjectError(error) }
    return firstProject(data)
  } catch (error) {
    return { ok: false, error: mapProjectError(error) }
  }
}

type NullableUpdateArgs = Omit<
  Database['public']['Functions']['update_project']['Args'],
  'p_description' | 'p_due_date' | 'p_start_date'
> & {
  p_description: string | null
  p_due_date: string | null
  p_start_date: string | null
}

export async function updateProject(
  client: SupabaseClient<Database>,
  input: ProjectUpdateInput,
): Promise<ProjectServiceResult<Project>> {
  const nullableArgs: NullableUpdateArgs = {
    p_project_id: input.projectId,
    p_name: input.name,
    p_description: input.description.trim() || null,
    p_status: input.status,
    p_start_date: input.startDate,
    p_due_date: input.dueDate,
    p_expected_updated_at: input.expectedUpdatedAt,
  }
  try {
    const { data, error } = await client.rpc(
      'update_project',
      nullableArgs as unknown as Database['public']['Functions']['update_project']['Args'],
    )
    if (error) return { ok: false, error: mapProjectError(error) }
    return firstProject(data)
  } catch (error) {
    return { ok: false, error: mapProjectError(error) }
  }
}

export async function archiveProject(
  client: SupabaseClient<Database>,
  projectId: string,
  expectedUpdatedAt: string,
): Promise<ProjectServiceResult<Project>> {
  try {
    const { data, error } = await client.rpc('archive_project', {
      p_project_id: projectId,
      p_expected_updated_at: expectedUpdatedAt,
    })
    if (error) return { ok: false, error: mapProjectError(error) }
    return firstProject(data)
  } catch (error) {
    return { ok: false, error: mapProjectError(error) }
  }
}

export async function listProjectMembers(
  client: SupabaseClient<Database>,
  projectId: string,
): Promise<ProjectServiceResult<ProjectMember[]>> {
  try {
    const { data, error } = await client.rpc('list_project_members', {
      p_project_id: projectId,
    })
    if (error) return { ok: false, error: mapProjectError(error) }
    return parseRows(data, parseProjectMember)
  } catch (error) {
    return { ok: false, error: mapProjectError(error) }
  }
}

export async function listProjectMemberCandidates(
  client: SupabaseClient<Database>,
  projectId: string,
): Promise<ProjectServiceResult<ProjectMemberCandidate[]>> {
  try {
    const { data, error } = await client.rpc('list_project_member_candidates', {
      p_project_id: projectId,
    })
    if (error) return { ok: false, error: mapProjectError(error) }
    return parseRows(data, parseProjectCandidate)
  } catch (error) {
    return { ok: false, error: mapProjectError(error) }
  }
}

async function runProjectMutation(
  operation: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<ProjectServiceResult<ProjectMutationResult>> {
  try {
    const { data, error } = await operation()
    if (error) return { ok: false, error: mapProjectError(error) }
    return firstProjectMutation(data)
  } catch (error) {
    return { ok: false, error: mapProjectError(error) }
  }
}

export function addProjectMember(
  client: SupabaseClient<Database>,
  input: ProjectMemberRoleInput,
): Promise<ProjectServiceResult<ProjectMutationResult>> {
  return runProjectMutation(() =>
    client.rpc('add_project_member', {
      p_project_id: input.projectId,
      p_user_id: input.userId,
      p_role: input.role,
    }),
  )
}

export function setProjectMemberRole(
  client: SupabaseClient<Database>,
  input: ProjectMemberRoleInput,
): Promise<ProjectServiceResult<ProjectMutationResult>> {
  return runProjectMutation(() =>
    client.rpc('set_project_member_role', {
      p_project_id: input.projectId,
      p_user_id: input.userId,
      p_role: input.role,
    }),
  )
}

export function removeProjectMember(
  client: SupabaseClient<Database>,
  input: ProjectMemberInput,
): Promise<ProjectServiceResult<ProjectMutationResult>> {
  return runProjectMutation(() =>
    client.rpc('remove_project_member', {
      p_project_id: input.projectId,
      p_user_id: input.userId,
    }),
  )
}

export function setProjectLead(
  client: SupabaseClient<Database>,
  input: ProjectLeadershipInput,
): Promise<ProjectServiceResult<ProjectMutationResult>> {
  return runProjectMutation(() =>
    client.rpc('set_project_lead', {
      p_project_id: input.projectId,
      p_user_id: input.userId,
      p_expected_updated_at: input.expectedUpdatedAt,
    }),
  )
}

export function clearProjectLead(
  client: SupabaseClient<Database>,
  input: ProjectClearLeadInput,
): Promise<ProjectServiceResult<ProjectMutationResult>> {
  return runProjectMutation(() =>
    client.rpc('clear_project_lead', {
      p_project_id: input.projectId,
      p_expected_updated_at: input.expectedUpdatedAt,
    }),
  )
}

export function transferProjectOwner(
  client: SupabaseClient<Database>,
  input: ProjectLeadershipInput,
): Promise<ProjectServiceResult<ProjectMutationResult>> {
  return runProjectMutation(() =>
    client.rpc('transfer_project_owner', {
      p_project_id: input.projectId,
      p_user_id: input.userId,
      p_expected_updated_at: input.expectedUpdatedAt,
    }),
  )
}
