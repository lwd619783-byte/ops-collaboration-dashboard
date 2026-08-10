import { createContext, useContext } from 'react'
import type { TaskServiceResult } from '@/features/tasks/taskService'
import type {
  Task,
  TaskAssignmentCandidate,
  TaskBlockInput,
  TaskCreateInput,
  TaskListInput,
  TaskProgressInput,
  TaskProgressResult,
  TaskProgressUpdate,
  TaskReview,
  TaskReviewInput,
  TaskReviewResult,
  TaskReturnReviewInput,
  TaskStatusHistoryItem,
  TaskSummary,
  TaskTransitionInput,
  TaskTransitionResult,
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
  start: (
    input: TaskTransitionInput,
  ) => Promise<TaskServiceResult<TaskTransitionResult>>
  block: (
    input: TaskBlockInput,
  ) => Promise<TaskServiceResult<TaskTransitionResult>>
  resume: (
    input: TaskTransitionInput,
  ) => Promise<TaskServiceResult<TaskTransitionResult>>
  cancel: (
    input: TaskTransitionInput,
  ) => Promise<TaskServiceResult<TaskTransitionResult>>
  listStatusHistory: (
    taskId: string,
  ) => Promise<TaskServiceResult<TaskStatusHistoryItem[]>>
  listUpdates: (
    taskId: string,
  ) => Promise<TaskServiceResult<TaskProgressUpdate[]>>
  createProgressUpdate: (
    input: TaskProgressInput,
  ) => Promise<TaskServiceResult<TaskProgressResult>>
  listReviews: (taskId: string) => Promise<TaskServiceResult<TaskReview[]>>
  submitReview: (
    input: TaskReviewInput,
  ) => Promise<TaskServiceResult<TaskReviewResult>>
  approveReview: (
    input: TaskReviewInput,
  ) => Promise<TaskServiceResult<TaskReviewResult>>
  returnReview: (
    input: TaskReturnReviewInput,
  ) => Promise<TaskServiceResult<TaskReviewResult>>
}

export const TaskContext = createContext<TaskContextValue | null>(null)

export function useTasks(): TaskContextValue {
  const context = useContext(TaskContext)
  if (!context) throw new Error('useTasks 必须在 TaskProvider 内部使用。')
  return context
}
