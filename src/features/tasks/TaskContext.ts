import { createContext, useContext } from 'react'
import type { TaskServiceResult } from '@/features/tasks/taskService'
import type {
  Task,
  TaskAssignmentCandidate,
  TaskCreateInput,
  TaskListInput,
  TaskSummary,
  TaskUpdateInput,
} from '@/features/tasks/types'

export type TaskContextValue = {
  get: (taskId: string) => Promise<TaskServiceResult<Task>>
  list: (input: TaskListInput) => Promise<TaskServiceResult<TaskSummary[]>>
  listCandidates: (
    projectId: string,
  ) => Promise<TaskServiceResult<TaskAssignmentCandidate[]>>
  create: (input: TaskCreateInput) => Promise<TaskServiceResult<Task>>
  update: (input: TaskUpdateInput) => Promise<TaskServiceResult<Task>>
}

export const TaskContext = createContext<TaskContextValue | null>(null)

export function useTasks(): TaskContextValue {
  const context = useContext(TaskContext)
  if (!context) throw new Error('useTasks 必须在 TaskProvider 内部使用。')
  return context
}
