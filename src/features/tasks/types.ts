import type { Database } from '@/types/database.generated'

export type TaskPriority = Database['public']['Enums']['task_priority']
export type TaskStatus = Database['public']['Enums']['task_status']
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
  | 'collaborators'
  | 'description'
  | 'due_date'
  | 'estimated_hours'
  | 'start_date'
  | 'visibility_users'
> & {
  acceptance_criteria: string | null
  collaborators: TaskPerson[]
  description: string | null
  due_date: string | null
  estimated_hours: number | null
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
