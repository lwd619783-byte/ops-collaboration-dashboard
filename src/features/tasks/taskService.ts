import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.generated'
import {
  createSafeTaskError,
  mapTaskError,
  type SafeTaskError,
} from '@/features/tasks/errors'
import {
  isTaskPriority,
  isTaskStatus,
  isTaskVisibility,
  isTaskWorkloadLevel,
} from '@/features/tasks/taskMeta'
import type {
  Task,
  TaskAssignmentCandidate,
  TaskCreateInput,
  TaskListInput,
  TaskPerson,
  TaskSummary,
  TaskUpdateInput,
} from '@/features/tasks/types'

export type TaskServiceResult<T> =
  { ok: true; data: T } | { ok: false; error: SafeTaskError }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value)
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

function isNullableDateOnly(value: unknown): value is string | null {
  return value === null || isDateOnly(value)
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) &&
    !Number.isNaN(Date.parse(value))
  )
}

function invalidPayload<T>(): TaskServiceResult<T> {
  return { ok: false, error: createSafeTaskError('unknown_service_error') }
}

function parsePeople(value: unknown): TaskPerson[] | null {
  if (!Array.isArray(value)) return null
  const people: TaskPerson[] = []
  const ids = new Set<string>()
  for (const person of value) {
    if (
      !isRecord(person) ||
      !isUuid(person.app_user_id) ||
      !isString(person.display_name) ||
      person.display_name.length === 0 ||
      ids.has(person.app_user_id)
    ) {
      return null
    }
    ids.add(person.app_user_id)
    people.push({
      app_user_id: person.app_user_id,
      display_name: person.display_name,
    })
  }
  return people
}

function parseTaskSummary(value: unknown): TaskSummary | null {
  if (!isRecord(value)) return null
  const collaborators = parsePeople(value.collaborators)
  if (
    !isUuid(value.task_id) ||
    !isUuid(value.project_id) ||
    !isUuid(value.workspace_id) ||
    !isUuid(value.module_id) ||
    !isString(value.module_name) ||
    value.module_name.trim().length === 0 ||
    !isString(value.title) ||
    value.title.trim() !== value.title ||
    value.title.length === 0 ||
    value.title.length > 200 ||
    !isUuid(value.assignee_id) ||
    !isString(value.assignee_display_name) ||
    value.assignee_display_name.trim().length === 0 ||
    collaborators === null ||
    collaborators.some((person) => person.app_user_id === value.assignee_id) ||
    !isTaskPriority(value.priority) ||
    !isNullableDateOnly(value.start_date) ||
    !isNullableDateOnly(value.due_date) ||
    !isNullableNumber(value.estimated_hours) ||
    (value.estimated_hours !== null &&
      (value.estimated_hours < 0 ||
        value.estimated_hours > 10000 ||
        Math.abs(
          value.estimated_hours * 100 - Math.round(value.estimated_hours * 100),
        ) > 1e-8)) ||
    !isTaskWorkloadLevel(value.workload_level) ||
    !isTaskVisibility(value.visibility) ||
    !isTaskStatus(value.status) ||
    typeof value.progress !== 'number' ||
    !Number.isInteger(value.progress) ||
    value.progress < 0 ||
    value.progress > 100 ||
    !isTimestamp(value.updated_at)
  ) {
    return null
  }
  if (
    value.start_date !== null &&
    value.due_date !== null &&
    value.due_date < value.start_date
  ) {
    return null
  }

  return {
    assignee_display_name: value.assignee_display_name,
    assignee_id: value.assignee_id,
    collaborators,
    due_date: value.due_date,
    estimated_hours: value.estimated_hours,
    module_id: value.module_id,
    module_name: value.module_name,
    priority: value.priority,
    progress: value.progress,
    project_id: value.project_id,
    start_date: value.start_date,
    status: value.status,
    task_id: value.task_id,
    title: value.title,
    updated_at: value.updated_at,
    visibility: value.visibility,
    workload_level: value.workload_level,
    workspace_id: value.workspace_id,
  }
}

function parseTaskSummaries(
  value: unknown,
  input: TaskListInput,
): TaskServiceResult<TaskSummary[]> {
  if (!Array.isArray(value)) return invalidPayload()
  const summaries = value.map(parseTaskSummary)
  if (summaries.some((summary) => summary === null)) return invalidPayload()
  const rows = summaries as TaskSummary[]
  const taskIds = new Set<string>()
  for (const row of rows) {
    if (
      row.project_id !== input.projectId ||
      row.workspace_id !== input.workspaceId ||
      taskIds.has(row.task_id)
    ) {
      return invalidPayload()
    }
    taskIds.add(row.task_id)
  }
  return { ok: true, data: rows }
}

function parseTask(value: unknown): Task | null {
  if (!isRecord(value)) return null
  const collaborators = parsePeople(value.collaborators)
  const visibilityUsers = parsePeople(value.visibility_users)
  if (
    !isString(value.task_id) ||
    !isString(value.project_id) ||
    !isString(value.workspace_id) ||
    !isString(value.module_id) ||
    !isString(value.module_name) ||
    value.module_name.length === 0 ||
    !isString(value.title) ||
    value.title.trim() !== value.title ||
    value.title.length === 0 ||
    value.title.length > 200 ||
    !isNullableString(value.description) ||
    !isNullableString(value.acceptance_criteria) ||
    !isString(value.assignee_id) ||
    !isString(value.assignee_display_name) ||
    !isString(value.reviewer_id) ||
    !isString(value.reviewer_display_name) ||
    !isTaskPriority(value.priority) ||
    !isNullableDateOnly(value.start_date) ||
    !isNullableDateOnly(value.due_date) ||
    !isNullableNumber(value.estimated_hours) ||
    (value.estimated_hours !== null &&
      (value.estimated_hours < 0 ||
        value.estimated_hours > 10000 ||
        Math.abs(
          value.estimated_hours * 100 - Math.round(value.estimated_hours * 100),
        ) > 1e-8)) ||
    !isTaskWorkloadLevel(value.workload_level) ||
    !isTaskVisibility(value.visibility) ||
    !isTaskStatus(value.status) ||
    typeof value.progress !== 'number' ||
    !Number.isInteger(value.progress) ||
    value.progress < 0 ||
    value.progress > 100 ||
    collaborators === null ||
    visibilityUsers === null ||
    !isString(value.created_by) ||
    !isTimestamp(value.created_at) ||
    !isString(value.updated_by) ||
    !isTimestamp(value.updated_at)
  ) {
    return null
  }
  if (
    collaborators.some((person) => person.app_user_id === value.assignee_id) ||
    (value.visibility === 'project' && visibilityUsers.length > 0) ||
    (value.start_date !== null &&
      value.due_date !== null &&
      value.due_date < value.start_date)
  ) {
    return null
  }

  return {
    acceptance_criteria: value.acceptance_criteria,
    assignee_display_name: value.assignee_display_name,
    assignee_id: value.assignee_id,
    collaborators,
    created_at: value.created_at,
    created_by: value.created_by,
    description: value.description,
    due_date: value.due_date,
    estimated_hours: value.estimated_hours,
    module_id: value.module_id,
    module_name: value.module_name,
    priority: value.priority,
    progress: value.progress,
    project_id: value.project_id,
    reviewer_display_name: value.reviewer_display_name,
    reviewer_id: value.reviewer_id,
    start_date: value.start_date,
    status: value.status,
    task_id: value.task_id,
    title: value.title,
    updated_at: value.updated_at,
    updated_by: value.updated_by,
    visibility: value.visibility,
    visibility_users: visibilityUsers,
    workload_level: value.workload_level,
    workspace_id: value.workspace_id,
  }
}

function firstTask(rows: unknown): TaskServiceResult<Task> {
  if (!Array.isArray(rows)) return invalidPayload()
  if (rows.length === 0) {
    return { ok: false, error: createSafeTaskError('not_found_or_forbidden') }
  }
  if (rows.length !== 1) return invalidPayload()
  const task = parseTask(rows[0])
  return task ? { ok: true, data: task } : invalidPayload()
}

function firstCreatedTask(rows: unknown): TaskServiceResult<Task> {
  if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0])) {
    return invalidPayload()
  }
  if (typeof rows[0].was_existing !== 'boolean') return invalidPayload()
  const task = parseTask(rows[0])
  return task ? { ok: true, data: task } : invalidPayload()
}

function parseCandidate(value: unknown): TaskAssignmentCandidate | null {
  if (
    !isRecord(value) ||
    !isString(value.project_id) ||
    !isString(value.workspace_id) ||
    !isString(value.app_user_id) ||
    !isString(value.display_name) ||
    value.project_id.length === 0 ||
    value.workspace_id.length === 0 ||
    value.app_user_id.length === 0 ||
    value.display_name.trim().length === 0 ||
    !['owner', 'lead', 'member', 'viewer'].includes(
      typeof value.project_role === 'string' ? value.project_role : '',
    ) ||
    typeof value.can_hold_responsibility !== 'boolean'
  ) {
    return null
  }
  if (value.can_hold_responsibility !== (value.project_role !== 'viewer')) {
    return null
  }
  return {
    app_user_id: value.app_user_id,
    can_hold_responsibility: value.can_hold_responsibility,
    display_name: value.display_name,
    project_id: value.project_id,
    project_role: value.project_role as TaskAssignmentCandidate['project_role'],
    workspace_id: value.workspace_id,
  }
}

export async function getTask(
  client: SupabaseClient<Database>,
  taskId: string,
): Promise<TaskServiceResult<Task>> {
  try {
    const { data, error } = await client.rpc('get_task', { p_task_id: taskId })
    if (error) return { ok: false, error: mapTaskError(error) }
    return firstTask(data)
  } catch (error) {
    return { ok: false, error: mapTaskError(error) }
  }
}

export async function listProjectTasks(
  client: SupabaseClient<Database>,
  input: TaskListInput,
): Promise<TaskServiceResult<TaskSummary[]>> {
  try {
    const { data, error } = await client.rpc('list_project_tasks', {
      p_project_id: input.projectId,
    })
    if (error) return { ok: false, error: mapTaskError(error) }
    return parseTaskSummaries(data, input)
  } catch (error) {
    return { ok: false, error: mapTaskError(error) }
  }
}

export async function listTaskAssignmentCandidates(
  client: SupabaseClient<Database>,
  projectId: string,
): Promise<TaskServiceResult<TaskAssignmentCandidate[]>> {
  try {
    const { data, error } = await client.rpc(
      'list_task_assignment_candidates',
      { p_project_id: projectId },
    )
    if (error) return { ok: false, error: mapTaskError(error) }
    if (!Array.isArray(data)) return invalidPayload()
    const candidates = data.map(parseCandidate)
    if (candidates.some((candidate) => candidate === null)) {
      return invalidPayload()
    }
    const rows = candidates as TaskAssignmentCandidate[]
    if (
      new Set(rows.map((candidate) => candidate.app_user_id)).size !==
      rows.length
    ) {
      return invalidPayload()
    }
    return { ok: true, data: rows }
  } catch (error) {
    return { ok: false, error: mapTaskError(error) }
  }
}

type CreateArgs = Database['public']['Functions']['create_task']['Args']
type NullableCreateArgs = Omit<
  CreateArgs,
  | 'p_acceptance_criteria'
  | 'p_description'
  | 'p_due_date'
  | 'p_estimated_hours'
  | 'p_start_date'
> & {
  p_acceptance_criteria: string | null
  p_description: string | null
  p_due_date: string | null
  p_estimated_hours: number | null
  p_start_date: string | null
}

function createArgs(input: TaskCreateInput): NullableCreateArgs {
  return {
    p_project_id: input.projectId,
    p_module_id: input.moduleId,
    p_title: input.title,
    p_description: input.description.trim() || null,
    p_acceptance_criteria: input.acceptanceCriteria.trim() || null,
    p_assignee_id: input.assigneeId,
    p_collaborator_ids: input.collaboratorIds,
    p_reviewer_id: input.reviewerId,
    p_priority: input.priority,
    p_start_date: input.startDate,
    p_due_date: input.dueDate,
    p_estimated_hours: input.estimatedHours,
    p_workload_level: input.workloadLevel,
    p_visibility: input.visibility,
    p_visibility_user_ids: input.visibilityUserIds,
    p_idempotency_key: input.idempotencyKey,
  }
}

export async function createTask(
  client: SupabaseClient<Database>,
  input: TaskCreateInput,
): Promise<TaskServiceResult<Task>> {
  try {
    const { data, error } = await client.rpc(
      'create_task',
      createArgs(input) as unknown as CreateArgs,
    )
    if (error) return { ok: false, error: mapTaskError(error) }
    return firstCreatedTask(data)
  } catch (error) {
    return { ok: false, error: mapTaskError(error) }
  }
}

type UpdateArgs = Database['public']['Functions']['update_task']['Args']
type NullableUpdateArgs = Omit<
  UpdateArgs,
  | 'p_acceptance_criteria'
  | 'p_description'
  | 'p_due_date'
  | 'p_estimated_hours'
  | 'p_start_date'
> & {
  p_acceptance_criteria: string | null
  p_description: string | null
  p_due_date: string | null
  p_estimated_hours: number | null
  p_start_date: string | null
}

export async function updateTask(
  client: SupabaseClient<Database>,
  input: TaskUpdateInput,
): Promise<TaskServiceResult<Task>> {
  const args: NullableUpdateArgs = {
    p_project_id: input.projectId,
    p_task_id: input.taskId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_module_id: input.moduleId,
    p_title: input.title,
    p_description: input.description.trim() || null,
    p_acceptance_criteria: input.acceptanceCriteria.trim() || null,
    p_assignee_id: input.assigneeId,
    p_collaborator_ids: input.collaboratorIds,
    p_reviewer_id: input.reviewerId,
    p_priority: input.priority,
    p_start_date: input.startDate,
    p_due_date: input.dueDate,
    p_estimated_hours: input.estimatedHours,
    p_workload_level: input.workloadLevel,
    p_visibility: input.visibility,
    p_visibility_user_ids: input.visibilityUserIds,
  }
  try {
    const { data, error } = await client.rpc(
      'update_task',
      args as unknown as UpdateArgs,
    )
    if (error) return { ok: false, error: mapTaskError(error) }
    return firstTask(data)
  } catch (error) {
    return { ok: false, error: mapTaskError(error) }
  }
}
