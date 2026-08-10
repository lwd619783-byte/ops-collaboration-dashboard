import type { Database } from '@/types/database.generated'

export type TaskPriority = Database['public']['Enums']['task_priority']
export type TaskReviewAction = Database['public']['Enums']['task_review_action']
export type TaskStatus = Database['public']['Enums']['task_status']
export type TaskStatusAction = Database['public']['Enums']['task_status_action']
export type TaskExecutionAction = Extract<
  TaskStatusAction,
  'start' | 'block' | 'resume' | 'cancel'
>
export type TaskVisibility = Database['public']['Enums']['task_visibility']
export type TaskWorkloadLevel =
  Database['public']['Enums']['task_workload_level']

export type TaskPerson = {
  app_user_id: string
  display_name: string
}

type GeneratedTask =
  Database['public']['Functions']['get_task']['Returns'][number]

export type Task = Omit<
  GeneratedTask,
  | 'acceptance_criteria'
  | 'blocked_at'
  | 'blocked_by'
  | 'blocked_by_display_name'
  | 'blocker_reason'
  | 'collaborators'
  | 'completed_at'
  | 'completed_by'
  | 'completed_by_display_name'
  | 'description'
  | 'due_date'
  | 'estimated_hours'
  | 'last_progress_at'
  | 'last_progress_by'
  | 'last_progress_by_display_name'
  | 'start_date'
  | 'visibility_users'
> & {
  acceptance_criteria: string | null
  blocked_at: string | null
  blocked_by: string | null
  blocked_by_display_name: string | null
  blocker_reason: string | null
  collaborators: TaskPerson[]
  completed_at: string | null
  completed_by: string | null
  completed_by_display_name: string | null
  description: string | null
  due_date: string | null
  estimated_hours: number | null
  last_progress_at: string | null
  last_progress_by: string | null
  last_progress_by_display_name: string | null
  start_date: string | null
  visibility_users: TaskPerson[]
}

type GeneratedTaskSummary =
  Database['public']['Functions']['list_project_tasks']['Returns'][number]

export type TaskSummary = Omit<
  GeneratedTaskSummary,
  'collaborators' | 'due_date' | 'estimated_hours' | 'start_date'
> & {
  collaborators: TaskPerson[]
  due_date: string | null
  estimated_hours: number | null
  start_date: string | null
}

export type TaskListInput = {
  projectId: string
  workspaceId: string
}

export type TaskAssignmentCandidate =
  Database['public']['Functions']['list_task_assignment_candidates']['Returns'][number]

export type TaskFormValues = {
  title: string
  moduleId: string
  assigneeId: string
  collaboratorIds: string[]
  reviewerId: string
  priority: TaskPriority
  startDate: string
  dueDate: string
  estimatedHours: string
  workloadLevel: TaskWorkloadLevel
  description: string
  acceptanceCriteria: string
  visibility: TaskVisibility
  visibilityUserIds: string[]
}

export type TaskCreateInput = {
  projectId: string
  moduleId: string
  title: string
  description: string
  acceptanceCriteria: string
  assigneeId: string
  collaboratorIds: string[]
  reviewerId: string
  priority: TaskPriority
  startDate: string | null
  dueDate: string | null
  estimatedHours: number | null
  workloadLevel: TaskWorkloadLevel
  visibility: TaskVisibility
  visibilityUserIds: string[]
  idempotencyKey: string
}

export type TaskUpdateInput = Omit<TaskCreateInput, 'idempotencyKey'> & {
  taskId: string
  expectedUpdatedAt: string
}

export type TaskTransitionInput = {
  taskId: string
  projectId: string
  workspaceId: string
  idempotencyKey: string
}

export type TaskReviewInput = TaskTransitionInput

export type TaskReturnReviewInput = TaskReviewInput & {
  returnReason: string
}

export type TaskBlockInput = TaskTransitionInput & {
  blockerReason: string
}

export type TaskStatusTransition = {
  transition_id: string
  task_id: string
  sequence: number
  from_status: TaskStatus
  to_status: TaskStatus
  action: TaskStatusAction
  created_at: string
}

type GeneratedTaskStatusHistoryItem =
  Database['public']['Functions']['list_task_status_history']['Returns'][number]

export type TaskStatusHistoryItem = Omit<
  GeneratedTaskStatusHistoryItem,
  'reason'
> & {
  reason: string | null
}

export type TaskTransitionResult = {
  transition: TaskStatusTransition
  was_existing: boolean
}

type GeneratedTaskReview =
  Database['public']['Functions']['list_task_reviews']['Returns'][number]

export type TaskReview = Omit<GeneratedTaskReview, 'return_reason'> & {
  return_reason: string | null
}

export type TaskReviewResult = {
  review: TaskReview
  transition: TaskStatusTransition
  was_existing: boolean
}

type GeneratedTaskProgressUpdate =
  Database['public']['Functions']['list_task_updates']['Returns'][number]

export type TaskProgressUpdate = Omit<
  GeneratedTaskProgressUpdate,
  'block_transition_id' | 'issues' | 'next_steps'
> & {
  block_transition_id: string | null
  issues: string | null
  next_steps: string | null
}

export type TaskProgressFormValues = {
  recordDate: string
  completedContent: string
  progress: string
  issues: string
  nextSteps: string
  needsAssistance: boolean
  markBlocked: boolean
  blockerReason: string
}

export type TaskProgressInput = {
  taskId: string
  projectId: string
  workspaceId: string
  recordDate: string
  completedContent: string
  progress: number
  issues: string
  nextSteps: string
  needsAssistance: boolean
  markBlocked: boolean
  blockerReason: string
  idempotencyKey: string
}

export type TaskProgressResult = {
  task: Task
  update: TaskProgressUpdate
  was_existing: boolean
}
