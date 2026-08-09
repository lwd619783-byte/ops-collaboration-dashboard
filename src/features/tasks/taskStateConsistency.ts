import type { Task, TaskStatusHistoryItem } from '@/features/tasks/types'
import { createSafeTaskError } from '@/features/tasks/errors'
import type { TaskServiceResult } from '@/features/tasks/taskService'

export const TASK_STATE_CONSISTENCY_MAX_ATTEMPTS = 3

export const TASK_STATE_CONFLICT_MESSAGE = '任务状态正在变化，请刷新后重试。'

export type TaskStateReader = {
  get: (taskId: string) => Promise<TaskServiceResult<Task>>
  listStatusHistory: (
    taskId: string,
  ) => Promise<TaskServiceResult<TaskStatusHistoryItem[]>>
}

export type ConsistentTaskState = {
  task: Task
  history: TaskStatusHistoryItem[]
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
  maxAttempts: number,
): Promise<TaskServiceResult<ConsistentTaskState>> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const historyResult = await reader.listStatusHistory(taskId)
    if (!historyResult.ok) return historyResult
    const taskResult = await reader.get(taskId)
    if (!taskResult.ok) return taskResult
    if (
      taskResult.data.task_id !== taskId ||
      historyResult.data.some((item) => item.task_id !== taskId)
    ) {
      return { ok: false, error: createSafeTaskError('unknown_service_error') }
    }
    if (!isTaskStatusHistoryConsistent(taskResult.data, historyResult.data)) {
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
    return {
      ok: true,
      data: { task: taskResult.data, history: historyResult.data },
    }
  }
  return { ok: false, error: createSafeTaskError('unknown_service_error') }
}

export async function loadConsistentTaskState(
  reader: TaskStateReader,
  taskId: string,
  maxAttempts: number = TASK_STATE_CONSISTENCY_MAX_ATTEMPTS,
): Promise<TaskServiceResult<ConsistentTaskState>> {
  return loadConsistentTaskStateWith(reader, taskId, null, maxAttempts)
}

export async function refreshConsistentTaskState(
  reader: TaskStateReader,
  taskId: string,
  expectedTransitionId: string,
  maxAttempts: number = TASK_STATE_CONSISTENCY_MAX_ATTEMPTS,
): Promise<TaskServiceResult<ConsistentTaskState>> {
  return loadConsistentTaskStateWith(
    reader,
    taskId,
    expectedTransitionId,
    maxAttempts,
  )
}
