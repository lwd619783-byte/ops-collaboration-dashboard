import { isTaskPriority, isTaskStatus } from '@/features/tasks/taskMeta'
import type {
  TaskPriority,
  TaskStatus,
  TaskSummary,
} from '@/features/tasks/types'

export const taskStatusOrder: readonly TaskStatus[] = [
  'todo',
  'in_progress',
  'blocked',
  'pending_review',
  'completed',
  'cancelled',
]

export type TaskListView = 'board' | 'list'

export type TaskListFilters = {
  moduleId: string | null
  assigneeId: string | null
  collaboratorId: string | null
  status: TaskStatus | null
  priority: TaskPriority | null
  overdue: boolean
}

export const emptyTaskListFilters: TaskListFilters = {
  moduleId: null,
  assigneeId: null,
  collaboratorId: null,
  status: null,
  priority: null,
  overdue: false,
}

export type TaskListFilterOptions = {
  moduleIds: ReadonlySet<string>
  assigneeIds: ReadonlySet<string>
  collaboratorIds: ReadonlySet<string>
}

export type TaskListState = {
  view: TaskListView
  filters: TaskListFilters
}

export function getLocalDateOnly(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isTaskOverdue(
  task: Pick<TaskSummary, 'due_date' | 'status'>,
  today: string,
): boolean {
  return (
    task.due_date !== null &&
    task.due_date < today &&
    task.status !== 'completed' &&
    task.status !== 'cancelled'
  )
}

export function hasActiveTaskFilters(filters: TaskListFilters): boolean {
  return (
    filters.moduleId !== null ||
    filters.assigneeId !== null ||
    filters.collaboratorId !== null ||
    filters.status !== null ||
    filters.priority !== null ||
    filters.overdue
  )
}

export function filterTaskSummaries(
  tasks: readonly TaskSummary[],
  filters: TaskListFilters,
  today: string,
): TaskSummary[] {
  return tasks.filter(
    (task) =>
      (filters.moduleId === null || task.module_id === filters.moduleId) &&
      (filters.assigneeId === null ||
        task.assignee_id === filters.assigneeId) &&
      (filters.collaboratorId === null ||
        task.collaborators.some(
          (person) => person.app_user_id === filters.collaboratorId,
        )) &&
      (filters.status === null || task.status === filters.status) &&
      (filters.priority === null || task.priority === filters.priority) &&
      (!filters.overdue || isTaskOverdue(task, today)),
  )
}

const priorityOrder: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export function sortTaskSummaries(
  tasks: readonly TaskSummary[],
  today: string,
): TaskSummary[] {
  return [...tasks].sort((left, right) => {
    const overdueDifference =
      Number(isTaskOverdue(right, today)) - Number(isTaskOverdue(left, today))
    if (overdueDifference !== 0) return overdueDifference

    if (left.due_date === null && right.due_date !== null) return 1
    if (left.due_date !== null && right.due_date === null) return -1
    if (left.due_date !== right.due_date) {
      return (left.due_date ?? '').localeCompare(right.due_date ?? '')
    }

    const priorityDifference =
      priorityOrder[left.priority] - priorityOrder[right.priority]
    if (priorityDifference !== 0) return priorityDifference

    const updatedDifference =
      Date.parse(right.updated_at) - Date.parse(left.updated_at)
    if (updatedDifference !== 0) return updatedDifference
    return left.task_id.localeCompare(right.task_id)
  })
}

export function parseTaskListState(
  searchParams: URLSearchParams,
  options: TaskListFilterOptions,
): TaskListState {
  const view = searchParams.get('view') === 'list' ? 'list' : 'board'
  const moduleValue = searchParams.get('module')
  const assigneeValue = searchParams.get('assignee')
  const collaboratorValue = searchParams.get('collaborator')
  const statusValue = searchParams.get('status')
  const priorityValue = searchParams.get('priority')

  return {
    view,
    filters: {
      moduleId:
        moduleValue !== null && options.moduleIds.has(moduleValue)
          ? moduleValue
          : null,
      assigneeId:
        assigneeValue !== null && options.assigneeIds.has(assigneeValue)
          ? assigneeValue
          : null,
      collaboratorId:
        collaboratorValue !== null &&
        options.collaboratorIds.has(collaboratorValue)
          ? collaboratorValue
          : null,
      status: isTaskStatus(statusValue) ? statusValue : null,
      priority: isTaskPriority(priorityValue) ? priorityValue : null,
      overdue: searchParams.get('overdue') === 'overdue',
    },
  }
}
