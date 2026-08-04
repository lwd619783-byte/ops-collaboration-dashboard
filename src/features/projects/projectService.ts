import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.generated'
import {
  createSafeProjectError,
  mapProjectError,
  type SafeProjectError,
} from '@/features/projects/errors'
import type {
  Project,
  ProjectCreateInput,
  ProjectListInput,
  ProjectUpdateInput,
} from '@/features/projects/types'

export type ProjectServiceResult<T> =
  { ok: true; data: T } | { ok: false; error: SafeProjectError }

type GeneratedProject =
  Database['public']['Functions']['list_projects']['Returns'][number]

function mapProject(row: GeneratedProject): Project {
  return {
    ...row,
    archived_at: row.archived_at ?? null,
    description: row.description ?? null,
    due_date: row.due_date ?? null,
    lead_display_name: row.lead_display_name ?? null,
    lead_id: row.lead_id ?? null,
    start_date: row.start_date ?? null,
  }
}

function firstProject(
  rows: GeneratedProject[] | null,
): ProjectServiceResult<Project> {
  const row = rows?.[0]
  if (!row) {
    return {
      ok: false,
      error: createSafeProjectError('not_found_or_forbidden'),
    }
  }
  return { ok: true, data: mapProject(row) }
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
    return { ok: true, data: (data ?? []).map(mapProject) }
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
