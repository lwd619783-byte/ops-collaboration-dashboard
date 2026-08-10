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
  TaskBlockInput,
  TaskCreateInput,
  TaskListInput,
  TaskPerson,
  TaskProgressInput,
  TaskProgressResult,
  TaskProgressUpdate,
  TaskReview,
  TaskReviewAction,
  TaskReviewInput,
  TaskReviewResult,
  TaskReturnReviewInput,
  TaskStatus,
  TaskStatusAction,
  TaskStatusHistoryItem,
  TaskSummary,
  TaskTransitionInput,
  TaskTransitionResult,
  TaskStatusTransition,
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

type TaskBlockerKey =
  'blocked_at' | 'blocked_by' | 'blocked_by_display_name' | 'blocker_reason'
type TaskCore = Omit<Task, TaskBlockerKey>

function parseTaskCore(value: unknown): TaskCore | null {
  if (!isRecord(value)) return null
  const collaborators = parsePeople(value.collaborators)
  const visibilityUsers = parsePeople(value.visibility_users)
  const validLatestProgress =
    isTimestamp(value.last_progress_at) &&
    isUuid(value.last_progress_by) &&
    isString(value.last_progress_by_display_name) &&
    value.last_progress_by_display_name.trim().length > 0
  const emptyLatestProgress =
    value.last_progress_at === null &&
    value.last_progress_by === null &&
    value.last_progress_by_display_name === null
  const validCompletion =
    value.status === 'completed' &&
    isTimestamp(value.completed_at) &&
    isUuid(value.completed_by) &&
    isString(value.completed_by_display_name) &&
    value.completed_by_display_name.trim().length > 0
  const emptyCompletion =
    value.status !== 'completed' &&
    value.completed_at === null &&
    value.completed_by === null &&
    value.completed_by_display_name === null
  if (
    !isUuid(value.task_id) ||
    !isUuid(value.project_id) ||
    !isUuid(value.workspace_id) ||
    !isUuid(value.module_id) ||
    !isString(value.module_name) ||
    value.module_name.length === 0 ||
    !isString(value.title) ||
    value.title.trim() !== value.title ||
    value.title.length === 0 ||
    value.title.length > 200 ||
    !isNullableString(value.description) ||
    !isNullableString(value.acceptance_criteria) ||
    !isUuid(value.assignee_id) ||
    !isString(value.assignee_display_name) ||
    !isUuid(value.reviewer_id) ||
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
    !isUuid(value.created_by) ||
    !isTimestamp(value.created_at) ||
    !isUuid(value.updated_by) ||
    !isTimestamp(value.updated_at) ||
    (!validLatestProgress && !emptyLatestProgress) ||
    (!validCompletion && !emptyCompletion)
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
    completed_at: value.completed_at as string | null,
    completed_by: value.completed_by as string | null,
    completed_by_display_name: value.completed_by_display_name as string | null,
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
    last_progress_at: value.last_progress_at as string | null,
    last_progress_by: value.last_progress_by as string | null,
    last_progress_by_display_name: value.last_progress_by_display_name as
      string | null,
  }
}

function parseLegacyMutationTaskCore(value: unknown): TaskCore | null {
  if (!isRecord(value)) return null
  return parseTaskCore({
    ...value,
    last_progress_at: null,
    last_progress_by: null,
    last_progress_by_display_name: null,
    completed_at: null,
    completed_by: null,
    completed_by_display_name: null,
  })
}

function parseTask(value: unknown): Task | null {
  const core = parseTaskCore(value)
  if (!core || !isRecord(value)) return null
  const blocked = core.status === 'blocked'
  const validBlockedFields =
    isString(value.blocker_reason) &&
    value.blocker_reason.trim() === value.blocker_reason &&
    value.blocker_reason.length > 0 &&
    value.blocker_reason.length <= 2000 &&
    isTimestamp(value.blocked_at) &&
    isUuid(value.blocked_by) &&
    isString(value.blocked_by_display_name) &&
    value.blocked_by_display_name.trim().length > 0
  const emptyBlockedFields =
    value.blocker_reason === null &&
    value.blocked_at === null &&
    value.blocked_by === null &&
    value.blocked_by_display_name === null
  if ((blocked && !validBlockedFields) || (!blocked && !emptyBlockedFields)) {
    return null
  }
  return {
    ...core,
    blocked_at: value.blocked_at as string | null,
    blocked_by: value.blocked_by as string | null,
    blocked_by_display_name: value.blocked_by_display_name as string | null,
    blocker_reason: value.blocker_reason as string | null,
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

function firstCreatedTask(rows: unknown): TaskServiceResult<TaskCore> {
  if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0])) {
    return invalidPayload()
  }
  if (typeof rows[0].was_existing !== 'boolean') return invalidPayload()
  const task = parseLegacyMutationTaskCore(rows[0])
  return task ? { ok: true, data: task } : invalidPayload()
}

const actionTransitions: Record<
  TaskStatusAction,
  { from: readonly TaskStatus[]; to: TaskStatus }
> = {
  start: { from: ['todo'], to: 'in_progress' },
  block: { from: ['in_progress'], to: 'blocked' },
  resume: { from: ['blocked'], to: 'in_progress' },
  cancel: { from: ['todo', 'in_progress', 'blocked'], to: 'cancelled' },
  submit_review: { from: ['in_progress'], to: 'pending_review' },
  approve_review: { from: ['pending_review'], to: 'completed' },
  return_review: { from: ['pending_review'], to: 'in_progress' },
}

function isTaskStatusAction(value: unknown): value is TaskStatusAction {
  return [
    'start',
    'block',
    'resume',
    'cancel',
    'submit_review',
    'approve_review',
    'return_review',
  ].includes(typeof value === 'string' ? value : '')
}

function parseTransition(value: unknown): TaskStatusTransition | null {
  if (
    !isRecord(value) ||
    !isUuid(value.transition_id) ||
    !isUuid(value.task_id) ||
    typeof value.sequence !== 'number' ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    !isTaskStatus(value.from_status) ||
    !isTaskStatus(value.to_status) ||
    !isTaskStatusAction(value.action) ||
    !isTimestamp(value.created_at)
  ) {
    return null
  }
  const expected = actionTransitions[value.action]
  if (
    !expected.from.includes(value.from_status) ||
    expected.to !== value.to_status
  ) {
    return null
  }
  return {
    transition_id: value.transition_id,
    task_id: value.task_id,
    sequence: value.sequence,
    from_status: value.from_status,
    to_status: value.to_status,
    action: value.action,
    created_at: value.created_at,
  }
}

function parseTransitionResult(
  value: unknown,
  input: TaskTransitionInput,
): TaskServiceResult<TaskTransitionResult> {
  if (!isRecord(value) || typeof value.was_existing !== 'boolean') {
    return invalidPayload()
  }
  const transitionTaskCore = parseLegacyMutationTaskCore(value.task)
  const task =
    transitionTaskCore && isRecord(value.task)
      ? parseTask({ ...value.task, ...transitionTaskCore })
      : null
  const transition = parseTransition(value.transition)
  if (
    !task ||
    !transition ||
    task.task_id !== input.taskId ||
    task.project_id !== input.projectId ||
    task.workspace_id !== input.workspaceId ||
    transition.task_id !== input.taskId ||
    (!value.was_existing && task.status !== transition.to_status)
  ) {
    return invalidPayload()
  }
  return {
    ok: true,
    data: { transition, was_existing: value.was_existing },
  }
}

function parseProgressUpdate(value: unknown): TaskProgressUpdate | null {
  if (
    !isRecord(value) ||
    !isUuid(value.update_id) ||
    !isUuid(value.task_id) ||
    typeof value.sequence !== 'number' ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    !isDateOnly(value.record_date) ||
    !isString(value.completed_content) ||
    value.completed_content.trim() !== value.completed_content ||
    value.completed_content.length === 0 ||
    value.completed_content.length > 10000 ||
    typeof value.progress !== 'number' ||
    !Number.isInteger(value.progress) ||
    value.progress < 0 ||
    value.progress > 100 ||
    !isNullableString(value.issues) ||
    !isNullableString(value.next_steps) ||
    (value.issues !== null &&
      (value.issues.trim() !== value.issues ||
        value.issues.length === 0 ||
        value.issues.length > 10000)) ||
    (value.next_steps !== null &&
      (value.next_steps.trim() !== value.next_steps ||
        value.next_steps.length === 0 ||
        value.next_steps.length > 10000)) ||
    typeof value.needs_assistance !== 'boolean' ||
    typeof value.is_blocked !== 'boolean' ||
    !isUuid(value.created_by) ||
    !isString(value.created_by_display_name) ||
    value.created_by_display_name.trim().length === 0 ||
    !isTimestamp(value.created_at)
  ) {
    return null
  }
  const blockTransitionId =
    value.block_transition_id === null
      ? null
      : isUuid(value.block_transition_id)
        ? value.block_transition_id
        : undefined
  if (
    blockTransitionId === undefined ||
    (blockTransitionId && !value.is_blocked)
  ) {
    return null
  }
  return {
    block_transition_id: blockTransitionId,
    completed_content: value.completed_content,
    created_at: value.created_at,
    created_by: value.created_by,
    created_by_display_name: value.created_by_display_name,
    is_blocked: value.is_blocked,
    issues: value.issues,
    needs_assistance: value.needs_assistance,
    next_steps: value.next_steps,
    progress: value.progress,
    record_date: value.record_date,
    sequence: value.sequence,
    task_id: value.task_id,
    update_id: value.update_id,
  }
}

function parseProgressUpdates(
  value: unknown,
  taskId: string,
): TaskServiceResult<TaskProgressUpdate[]> {
  if (!Array.isArray(value)) return invalidPayload()
  const updates = value.map(parseProgressUpdate)
  if (updates.some((update) => update === null)) return invalidPayload()
  const rows = updates as TaskProgressUpdate[]
  const updateIds = new Set<string>()
  const transitionIds = new Set<string>()
  for (const [index, update] of rows.entries()) {
    if (
      update.task_id !== taskId ||
      update.sequence !== index + 1 ||
      updateIds.has(update.update_id) ||
      (update.block_transition_id !== null &&
        transitionIds.has(update.block_transition_id))
    ) {
      return invalidPayload()
    }
    updateIds.add(update.update_id)
    if (update.block_transition_id)
      transitionIds.add(update.block_transition_id)
  }
  return { ok: true, data: rows }
}

function parseProgressResult(
  value: unknown,
  input: TaskProgressInput,
): TaskServiceResult<TaskProgressResult> {
  if (!isRecord(value) || typeof value.was_existing !== 'boolean') {
    return invalidPayload()
  }
  const task = isRecord(value.task)
    ? parseTask({
        ...value.task,
        completed_at: null,
        completed_by: null,
        completed_by_display_name: null,
      })
    : null
  const update = parseProgressUpdate(value.update)
  if (
    !task ||
    !update ||
    task.task_id !== input.taskId ||
    task.project_id !== input.projectId ||
    task.workspace_id !== input.workspaceId ||
    update.task_id !== input.taskId ||
    update.record_date !== input.recordDate ||
    update.completed_content !== input.completedContent.trim() ||
    update.progress !== input.progress ||
    update.issues !== (input.issues.trim() || null) ||
    update.next_steps !== (input.nextSteps.trim() || null) ||
    update.needs_assistance !== input.needsAssistance ||
    (update.block_transition_id !== null) !== input.markBlocked ||
    (!value.was_existing &&
      (task.progress !== update.progress ||
        task.last_progress_at !== update.created_at ||
        task.last_progress_by !== update.created_by ||
        (update.block_transition_id !== null && task.status !== 'blocked')))
  ) {
    return invalidPayload()
  }
  return {
    ok: true,
    data: { task, update, was_existing: value.was_existing },
  }
}

function parseHistoryItem(value: unknown): TaskStatusHistoryItem | null {
  if (
    !isRecord(value) ||
    !isUuid(value.transition_id) ||
    !isUuid(value.task_id) ||
    typeof value.sequence !== 'number' ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    !isTaskStatus(value.from_status) ||
    !isTaskStatus(value.to_status) ||
    !isTaskStatusAction(value.action) ||
    !isUuid(value.actor_id) ||
    !isString(value.actor_display_name) ||
    value.actor_display_name.trim().length === 0 ||
    !isTimestamp(value.created_at)
  ) {
    return null
  }
  const expected = actionTransitions[value.action]
  const validReason =
    value.action === 'block' || value.action === 'return_review'
      ? isString(value.reason) &&
        value.reason.trim() === value.reason &&
        value.reason.length > 0 &&
        value.reason.length <= 2000
      : value.reason === null
  if (
    !expected.from.includes(value.from_status) ||
    expected.to !== value.to_status ||
    !validReason
  ) {
    return null
  }
  return {
    transition_id: value.transition_id,
    task_id: value.task_id,
    sequence: value.sequence,
    from_status: value.from_status,
    to_status: value.to_status,
    action: value.action,
    reason: value.reason as string | null,
    actor_id: value.actor_id,
    actor_display_name: value.actor_display_name,
    created_at: value.created_at,
  }
}

function parseHistory(
  value: unknown,
  taskId: string,
): TaskServiceResult<TaskStatusHistoryItem[]> {
  if (!Array.isArray(value)) return invalidPayload()
  const history = value.map(parseHistoryItem)
  if (history.some((item) => item === null)) return invalidPayload()
  const rows = history as TaskStatusHistoryItem[]
  const transitionIds = new Set<string>()
  for (const [index, item] of rows.entries()) {
    if (
      item.task_id !== taskId ||
      item.sequence !== index + 1 ||
      transitionIds.has(item.transition_id) ||
      (index > 0 && rows[index - 1].to_status !== item.from_status)
    ) {
      return invalidPayload()
    }
    transitionIds.add(item.transition_id)
  }
  return { ok: true, data: rows }
}

const reviewTransitions: Record<
  TaskReviewAction,
  {
    from: TaskStatus
    to: TaskStatus
    statusAction: TaskStatusAction
  }
> = {
  submit: {
    from: 'in_progress',
    to: 'pending_review',
    statusAction: 'submit_review',
  },
  approve: {
    from: 'pending_review',
    to: 'completed',
    statusAction: 'approve_review',
  },
  return: {
    from: 'pending_review',
    to: 'in_progress',
    statusAction: 'return_review',
  },
}

function isTaskReviewAction(value: unknown): value is TaskReviewAction {
  return ['submit', 'approve', 'return'].includes(
    typeof value === 'string' ? value : '',
  )
}

function parseReview(value: unknown): TaskReview | null {
  if (
    !isRecord(value) ||
    !isUuid(value.review_id) ||
    !isUuid(value.task_id) ||
    typeof value.sequence !== 'number' ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    !isTaskReviewAction(value.action) ||
    !isUuid(value.actor_id) ||
    !isString(value.actor_display_name) ||
    value.actor_display_name.trim().length === 0 ||
    !isTaskStatus(value.from_status) ||
    !isTaskStatus(value.to_status) ||
    !isUuid(value.status_transition_id) ||
    !isTimestamp(value.created_at)
  ) {
    return null
  }
  const expected = reviewTransitions[value.action]
  const validReason =
    value.action === 'return'
      ? isString(value.return_reason) &&
        value.return_reason.trim() === value.return_reason &&
        value.return_reason.length > 0 &&
        value.return_reason.length <= 2000
      : value.return_reason === null
  if (
    value.from_status !== expected.from ||
    value.to_status !== expected.to ||
    !validReason
  ) {
    return null
  }
  return {
    action: value.action,
    actor_display_name: value.actor_display_name,
    actor_id: value.actor_id,
    created_at: value.created_at,
    from_status: value.from_status,
    return_reason: value.return_reason as string | null,
    review_id: value.review_id,
    sequence: value.sequence,
    status_transition_id: value.status_transition_id,
    task_id: value.task_id,
    to_status: value.to_status,
  }
}

function parseReviews(
  value: unknown,
  taskId: string,
): TaskServiceResult<TaskReview[]> {
  if (!Array.isArray(value)) return invalidPayload()
  const reviews = value.map(parseReview)
  if (reviews.some((review) => review === null)) return invalidPayload()
  const rows = reviews as TaskReview[]
  const reviewIds = new Set<string>()
  const transitionIds = new Set<string>()
  for (const [index, review] of rows.entries()) {
    if (
      review.task_id !== taskId ||
      review.sequence !== index + 1 ||
      reviewIds.has(review.review_id) ||
      transitionIds.has(review.status_transition_id)
    ) {
      return invalidPayload()
    }
    reviewIds.add(review.review_id)
    transitionIds.add(review.status_transition_id)
  }
  return { ok: true, data: rows }
}

function parseReviewResult(
  value: unknown,
  input: TaskReviewInput,
  action: TaskReviewAction,
  returnReason: string | null,
): TaskServiceResult<TaskReviewResult> {
  if (!isRecord(value) || typeof value.was_existing !== 'boolean') {
    return invalidPayload()
  }
  const task = parseTask(value.task)
  const review = parseReview(value.review)
  const transition = parseTransition(value.transition)
  const expected = reviewTransitions[action]
  if (
    !task ||
    !review ||
    !transition ||
    task.task_id !== input.taskId ||
    task.project_id !== input.projectId ||
    task.workspace_id !== input.workspaceId ||
    review.task_id !== input.taskId ||
    review.action !== action ||
    review.return_reason !== returnReason ||
    review.status_transition_id !== transition.transition_id ||
    review.actor_id.length === 0 ||
    review.from_status !== transition.from_status ||
    review.to_status !== transition.to_status ||
    review.created_at !== transition.created_at ||
    transition.task_id !== input.taskId ||
    transition.action !== expected.statusAction ||
    (!value.was_existing && task.status !== expected.to) ||
    (!value.was_existing &&
      action === 'approve' &&
      (task.completed_at !== review.created_at ||
        task.completed_by !== review.actor_id ||
        task.completed_by_display_name !== review.actor_display_name))
  ) {
    return invalidPayload()
  }
  return {
    ok: true,
    data: { review, transition, was_existing: value.was_existing },
  }
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
    const created = firstCreatedTask(data)
    if (!created.ok) return created
    const refreshed = await getTask(client, created.data.task_id)
    if (
      !refreshed.ok ||
      refreshed.data.project_id !== input.projectId ||
      refreshed.data.workspace_id !== created.data.workspace_id
    ) {
      return refreshed.ok ? invalidPayload() : refreshed
    }
    return refreshed
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
    if (!Array.isArray(data) || data.length !== 1) return invalidPayload()
    const updated = parseLegacyMutationTaskCore(data[0])
    if (!updated) return invalidPayload()
    const refreshed = await getTask(client, updated.task_id)
    if (
      !refreshed.ok ||
      refreshed.data.project_id !== input.projectId ||
      refreshed.data.workspace_id !== updated.workspace_id
    ) {
      return refreshed.ok ? invalidPayload() : refreshed
    }
    return refreshed
  } catch (error) {
    return { ok: false, error: mapTaskError(error) }
  }
}

async function runTransition(
  input: TaskTransitionInput,
  request: () => Promise<{ data: unknown; error: unknown }>,
): Promise<TaskServiceResult<TaskTransitionResult>> {
  try {
    const { data, error } = await request()
    if (error) return { ok: false, error: mapTaskError(error) }
    return parseTransitionResult(data, input)
  } catch (error) {
    return { ok: false, error: mapTaskError(error) }
  }
}

export async function startTask(
  client: SupabaseClient<Database>,
  input: TaskTransitionInput,
): Promise<TaskServiceResult<TaskTransitionResult>> {
  return runTransition(input, async () =>
    client.rpc('start_task', {
      p_task_id: input.taskId,
      p_idempotency_key: input.idempotencyKey,
    }),
  )
}

export async function blockTask(
  client: SupabaseClient<Database>,
  input: TaskBlockInput,
): Promise<TaskServiceResult<TaskTransitionResult>> {
  return runTransition(input, async () =>
    client.rpc('block_task', {
      p_task_id: input.taskId,
      p_blocker_reason: input.blockerReason,
      p_idempotency_key: input.idempotencyKey,
    }),
  )
}

export async function resumeTask(
  client: SupabaseClient<Database>,
  input: TaskTransitionInput,
): Promise<TaskServiceResult<TaskTransitionResult>> {
  return runTransition(input, async () =>
    client.rpc('resume_task', {
      p_task_id: input.taskId,
      p_idempotency_key: input.idempotencyKey,
    }),
  )
}

export async function cancelTask(
  client: SupabaseClient<Database>,
  input: TaskTransitionInput,
): Promise<TaskServiceResult<TaskTransitionResult>> {
  return runTransition(input, async () =>
    client.rpc('cancel_task', {
      p_task_id: input.taskId,
      p_idempotency_key: input.idempotencyKey,
    }),
  )
}

export async function listTaskStatusHistory(
  client: SupabaseClient<Database>,
  taskId: string,
): Promise<TaskServiceResult<TaskStatusHistoryItem[]>> {
  try {
    const { data, error } = await client.rpc('list_task_status_history', {
      p_task_id: taskId,
    })
    if (error) return { ok: false, error: mapTaskError(error) }
    return parseHistory(data, taskId)
  } catch (error) {
    return { ok: false, error: mapTaskError(error) }
  }
}

export async function listTaskUpdates(
  client: SupabaseClient<Database>,
  taskId: string,
): Promise<TaskServiceResult<TaskProgressUpdate[]>> {
  try {
    const { data, error } = await client.rpc('list_task_updates', {
      p_task_id: taskId,
    })
    if (error) return { ok: false, error: mapTaskError(error) }
    return parseProgressUpdates(data, taskId)
  } catch (error) {
    return { ok: false, error: mapTaskError(error) }
  }
}

export async function listTaskReviews(
  client: SupabaseClient<Database>,
  taskId: string,
): Promise<TaskServiceResult<TaskReview[]>> {
  try {
    const { data, error } = await client.rpc('list_task_reviews', {
      p_task_id: taskId,
    })
    if (error) return { ok: false, error: mapTaskError(error) }
    return parseReviews(data, taskId)
  } catch (error) {
    return { ok: false, error: mapTaskError(error) }
  }
}

async function runReview(
  input: TaskReviewInput,
  action: TaskReviewAction,
  returnReason: string | null,
  request: () => Promise<{ data: unknown; error: unknown }>,
): Promise<TaskServiceResult<TaskReviewResult>> {
  try {
    const { data, error } = await request()
    if (error) return { ok: false, error: mapTaskError(error) }
    return parseReviewResult(data, input, action, returnReason)
  } catch (error) {
    return { ok: false, error: mapTaskError(error) }
  }
}

export async function submitTaskForReview(
  client: SupabaseClient<Database>,
  input: TaskReviewInput,
): Promise<TaskServiceResult<TaskReviewResult>> {
  return runReview(input, 'submit', null, async () =>
    client.rpc('submit_task_for_review', {
      p_task_id: input.taskId,
      p_idempotency_key: input.idempotencyKey,
    }),
  )
}

export async function approveTaskReview(
  client: SupabaseClient<Database>,
  input: TaskReviewInput,
): Promise<TaskServiceResult<TaskReviewResult>> {
  return runReview(input, 'approve', null, async () =>
    client.rpc('approve_task_review', {
      p_task_id: input.taskId,
      p_idempotency_key: input.idempotencyKey,
    }),
  )
}

export async function returnTaskReview(
  client: SupabaseClient<Database>,
  input: TaskReturnReviewInput,
): Promise<TaskServiceResult<TaskReviewResult>> {
  const normalizedReason = input.returnReason.trim()
  return runReview(input, 'return', normalizedReason, async () =>
    client.rpc('return_task_review', {
      p_task_id: input.taskId,
      p_return_reason: normalizedReason,
      p_idempotency_key: input.idempotencyKey,
    }),
  )
}

type CreateProgressArgs =
  Database['public']['Functions']['create_task_update']['Args']
type NullableCreateProgressArgs = Omit<
  CreateProgressArgs,
  'p_blocker_reason' | 'p_issues' | 'p_next_steps'
> & {
  p_blocker_reason: string | null
  p_issues: string | null
  p_next_steps: string | null
}

export async function createTaskProgressUpdate(
  client: SupabaseClient<Database>,
  input: TaskProgressInput,
): Promise<TaskServiceResult<TaskProgressResult>> {
  const args: NullableCreateProgressArgs = {
    p_task_id: input.taskId,
    p_record_date: input.recordDate,
    p_completed_content: input.completedContent.trim(),
    p_progress: input.progress,
    p_issues: input.issues.trim() || null,
    p_next_steps: input.nextSteps.trim() || null,
    p_needs_assistance: input.needsAssistance,
    p_mark_blocked: input.markBlocked,
    p_blocker_reason: input.markBlocked
      ? input.blockerReason.trim() || null
      : null,
    p_idempotency_key: input.idempotencyKey,
  }
  try {
    const { data, error } = await client.rpc(
      'create_task_update',
      args as unknown as CreateProgressArgs,
    )
    if (error) return { ok: false, error: mapTaskError(error) }
    return parseProgressResult(data, input)
  } catch (error) {
    return { ok: false, error: mapTaskError(error) }
  }
}
