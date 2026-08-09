import type {
  Task,
  TaskProgressUpdate,
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
}

export type ConsistentTaskState = {
  task: Task
  history: TaskStatusHistoryItem[]
  updates: TaskProgressUpdate[]
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
  maxAttempts: number,
): Promise<TaskServiceResult<ConsistentTaskState>> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const historyResult = await reader.listStatusHistory(taskId)
    if (!historyResult.ok) return historyResult
    const updatesResult = await reader.listUpdates(taskId)
    if (!updatesResult.ok) return updatesResult
    const taskResult = await reader.get(taskId)
    if (!taskResult.ok) return taskResult
    if (
      taskResult.data.task_id !== taskId ||
      historyResult.data.some((item) => item.task_id !== taskId) ||
      updatesResult.data.some((item) => item.task_id !== taskId)
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
    return {
      ok: true,
      data: {
        task: taskResult.data,
        history: historyResult.data,
        updates: updatesResult.data,
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
  return loadConsistentTaskStateWith(reader, taskId, null, null, maxAttempts)
}

export async function refreshConsistentTaskState(
  reader: TaskStateReader,
  taskId: string,
  expectedTransitionId: string | null,
  expectedUpdateId: string | null = null,
  maxAttempts: number = TASK_STATE_CONSISTENCY_MAX_ATTEMPTS,
): Promise<TaskServiceResult<ConsistentTaskState>> {
  return loadConsistentTaskStateWith(
    reader,
    taskId,
    expectedTransitionId,
    expectedUpdateId,
    maxAttempts,
  )
}
