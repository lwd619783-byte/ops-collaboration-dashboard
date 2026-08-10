import type {
  Task,
  TaskProgressUpdate,
  TaskReview,
  TaskReviewAction,
  TaskStatusHistoryItem,
} from '@/features/tasks/types'
import { createSafeTaskError } from '@/features/tasks/errors'
import type { TaskServiceResult } from '@/features/tasks/taskService'

export const TASK_STATE_CONSISTENCY_MAX_ATTEMPTS = 3

export const TASK_STATE_CONFLICT_MESSAGE = '任务状态正在变化，请刷新后重试。'

export type TaskStateReader = {
  get: (taskId: string) => Promise<TaskServiceResult<Task>>
  listStatusHistory: (
    taskId: string,
  ) => Promise<TaskServiceResult<TaskStatusHistoryItem[]>>
  listUpdates: (
    taskId: string,
  ) => Promise<TaskServiceResult<TaskProgressUpdate[]>>
  listReviews: (taskId: string) => Promise<TaskServiceResult<TaskReview[]>>
}

export type ConsistentTaskState = {
  task: Task
  history: TaskStatusHistoryItem[]
  updates: TaskProgressUpdate[]
  reviews: TaskReview[]
}

const reviewStatusActions = {
  submit: 'submit_review',
  approve: 'approve_review',
  return: 'return_review',
} as const

const reviewDomainHistoryActions = new Set<string>([
  'submit_review',
  'approve_review',
  'return_review',
])

const historyActionToReviewAction: Record<
  string,
  TaskReviewAction | undefined
> = {
  submit_review: 'submit',
  approve_review: 'approve',
  return_review: 'return',
}

export function isTaskReviewConsistent(
  task: Task,
  history: readonly TaskStatusHistoryItem[],
  reviews: readonly TaskReview[],
): boolean {
  if (
    reviews.some((review) => {
      const transition = history.find(
        (item) => item.transition_id === review.status_transition_id,
      )
      return (
        !transition ||
        transition.task_id !== review.task_id ||
        transition.actor_id !== review.actor_id ||
        transition.action !== reviewStatusActions[review.action] ||
        transition.from_status !== review.from_status ||
        transition.to_status !== review.to_status ||
        transition.reason !== review.return_reason ||
        transition.created_at !== review.created_at
      )
    })
  ) {
    return false
  }

  for (const item of history) {
    if (!reviewDomainHistoryActions.has(item.action)) continue
    const expectedReviewAction = historyActionToReviewAction[item.action]
    if (!expectedReviewAction) continue
    const matchingReviews = reviews.filter(
      (review) =>
        review.status_transition_id === item.transition_id &&
        review.task_id === item.task_id &&
        review.actor_id === item.actor_id &&
        review.action === expectedReviewAction &&
        review.from_status === item.from_status &&
        review.to_status === item.to_status &&
        review.return_reason === item.reason &&
        review.created_at === item.created_at,
    )
    if (matchingReviews.length !== 1) {
      return false
    }
  }

  const validCompletion =
    task.status === 'completed' &&
    task.completed_at !== null &&
    task.completed_by !== null &&
    task.completed_by_display_name !== null
  const emptyCompletion =
    task.status !== 'completed' &&
    task.completed_at === null &&
    task.completed_by === null &&
    task.completed_by_display_name === null
  if (!validCompletion && !emptyCompletion) return false

  const latest = reviews[reviews.length - 1]
  if (task.status === 'pending_review') {
    return latest?.action === 'submit' && latest.to_status === 'pending_review'
  }
  if (task.status === 'completed') {
    return (
      latest?.action === 'approve' &&
      latest.to_status === 'completed' &&
      task.completed_at === latest.created_at &&
      task.completed_by === latest.actor_id &&
      task.completed_by_display_name === latest.actor_display_name
    )
  }
  return true
}

export function isTaskProgressConsistent(
  task: Task,
  history: readonly TaskStatusHistoryItem[],
  updates: readonly TaskProgressUpdate[],
): boolean {
  for (const update of updates) {
    if (
      update.block_transition_id !== null &&
      !history.some(
        (item) =>
          item.transition_id === update.block_transition_id &&
          item.task_id === update.task_id &&
          item.action === 'block' &&
          item.to_status === 'blocked',
      )
    ) {
      return false
    }
  }
  const latest = updates[updates.length - 1]
  if (!latest) {
    return (
      task.progress === 0 &&
      task.last_progress_at === null &&
      task.last_progress_by === null &&
      task.last_progress_by_display_name === null
    )
  }
  return (
    latest.task_id === task.task_id &&
    latest.progress === task.progress &&
    latest.created_at === task.last_progress_at &&
    latest.created_by === task.last_progress_by &&
    latest.created_by_display_name === task.last_progress_by_display_name
  )
}

export function isTaskStatusHistoryConsistent(
  task: Task,
  history: readonly TaskStatusHistoryItem[],
): boolean {
  if (history.length === 0) {
    return task.status === 'todo'
  }
  const tail = history[history.length - 1]
  return tail.to_status === task.status
}

async function loadConsistentTaskStateWith(
  reader: TaskStateReader,
  taskId: string,
  expectedTransitionId: string | null,
  expectedUpdateId: string | null,
  expectedReviewId: string | null,
  maxAttempts: number,
): Promise<TaskServiceResult<ConsistentTaskState>> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const historyResult = await reader.listStatusHistory(taskId)
    if (!historyResult.ok) return historyResult
    const updatesResult = await reader.listUpdates(taskId)
    if (!updatesResult.ok) return updatesResult
    const reviewsResult = await reader.listReviews(taskId)
    if (!reviewsResult.ok) return reviewsResult
    const taskResult = await reader.get(taskId)
    if (!taskResult.ok) return taskResult
    if (
      taskResult.data.task_id !== taskId ||
      historyResult.data.some((item) => item.task_id !== taskId) ||
      updatesResult.data.some((item) => item.task_id !== taskId) ||
      reviewsResult.data.some((item) => item.task_id !== taskId)
    ) {
      return { ok: false, error: createSafeTaskError('unknown_service_error') }
    }
    if (!isTaskStatusHistoryConsistent(taskResult.data, historyResult.data)) {
      continue
    }
    if (
      !isTaskProgressConsistent(
        taskResult.data,
        historyResult.data,
        updatesResult.data,
      )
    ) {
      continue
    }
    if (
      !isTaskReviewConsistent(
        taskResult.data,
        historyResult.data,
        reviewsResult.data,
      )
    ) {
      continue
    }
    if (
      expectedTransitionId !== null &&
      !historyResult.data.some(
        (item) => item.transition_id === expectedTransitionId,
      )
    ) {
      continue
    }
    if (
      expectedUpdateId !== null &&
      !updatesResult.data.some((item) => item.update_id === expectedUpdateId)
    ) {
      continue
    }
    if (
      expectedReviewId !== null &&
      !reviewsResult.data.some((item) => item.review_id === expectedReviewId)
    ) {
      continue
    }
    return {
      ok: true,
      data: {
        task: taskResult.data,
        history: historyResult.data,
        updates: updatesResult.data,
        reviews: reviewsResult.data,
      },
    }
  }
  return { ok: false, error: createSafeTaskError('unknown_service_error') }
}

export async function loadConsistentTaskState(
  reader: TaskStateReader,
  taskId: string,
  maxAttempts: number = TASK_STATE_CONSISTENCY_MAX_ATTEMPTS,
): Promise<TaskServiceResult<ConsistentTaskState>> {
  return loadConsistentTaskStateWith(
    reader,
    taskId,
    null,
    null,
    null,
    maxAttempts,
  )
}

export async function refreshConsistentTaskState(
  reader: TaskStateReader,
  taskId: string,
  expectedTransitionId: string | null,
  expectedUpdateId: string | null = null,
  expectedReviewId: string | null = null,
  maxAttempts: number = TASK_STATE_CONSISTENCY_MAX_ATTEMPTS,
): Promise<TaskServiceResult<ConsistentTaskState>> {
  return loadConsistentTaskStateWith(
    reader,
    taskId,
    expectedTransitionId,
    expectedUpdateId,
    expectedReviewId,
    maxAttempts,
  )
}
