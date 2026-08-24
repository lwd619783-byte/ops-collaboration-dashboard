import { useCallback, useMemo, type PropsWithChildren } from 'react'
import { createSafeTaskError } from '@/features/tasks/errors'
import { TaskContext } from '@/features/tasks/TaskContext'
import {
  blockTask,
  approveTaskReview,
  cancelTask,
  createTask,
  createTaskProgressUpdate,
  getTask,
  listProjectTasks,
  listMyTasks,
  listTaskStatusHistory,
  listTaskUpdates,
  listTaskReviews,
  listTaskAssignmentCandidates,
  resumeTask,
  returnTaskReview,
  startTask,
  submitTaskForReview,
  updateTask,
  type TaskServiceResult,
} from '@/features/tasks/taskService'
import {
  getSupabaseClient,
  type SupabaseClientResolution,
} from '@/lib/supabase/client'

type TaskProviderProps = PropsWithChildren<{
  resolveClient?: () => SupabaseClientResolution
}>

export function TaskProvider({
  children,
  resolveClient = getSupabaseClient,
}: TaskProviderProps) {
  const withClient = useCallback(
    <T,>(
      operation: (
        client: Extract<
          SupabaseClientResolution,
          { status: 'ready' }
        >['client'],
      ) => Promise<TaskServiceResult<T>>,
    ): Promise<TaskServiceResult<T>> => {
      const resolution = resolveClient()
      if (resolution.status !== 'ready') {
        return Promise.resolve({
          ok: false,
          error: createSafeTaskError('configuration_unavailable'),
        })
      }
      return operation(resolution.client)
    },
    [resolveClient],
  )

  const value = useMemo(
    () => ({
      get: (taskId: string) => withClient((client) => getTask(client, taskId)),
      list: (input: Parameters<typeof listProjectTasks>[1]) =>
        withClient((client) => listProjectTasks(client, input)),
      listMine: (input: Parameters<typeof listMyTasks>[1]) =>
        withClient((client) => listMyTasks(client, input)),
      listCandidates: (projectId: string) =>
        withClient((client) => listTaskAssignmentCandidates(client, projectId)),
      create: (input: Parameters<typeof createTask>[1]) =>
        withClient((client) => createTask(client, input)),
      update: (input: Parameters<typeof updateTask>[1]) =>
        withClient((client) => updateTask(client, input)),
      start: (input: Parameters<typeof startTask>[1]) =>
        withClient((client) => startTask(client, input)),
      block: (input: Parameters<typeof blockTask>[1]) =>
        withClient((client) => blockTask(client, input)),
      resume: (input: Parameters<typeof resumeTask>[1]) =>
        withClient((client) => resumeTask(client, input)),
      cancel: (input: Parameters<typeof cancelTask>[1]) =>
        withClient((client) => cancelTask(client, input)),
      listStatusHistory: (taskId: string) =>
        withClient((client) => listTaskStatusHistory(client, taskId)),
      listUpdates: (taskId: string) =>
        withClient((client) => listTaskUpdates(client, taskId)),
      createProgressUpdate: (
        input: Parameters<typeof createTaskProgressUpdate>[1],
      ) => withClient((client) => createTaskProgressUpdate(client, input)),
      listReviews: (taskId: string) =>
        withClient((client) => listTaskReviews(client, taskId)),
      submitReview: (input: Parameters<typeof submitTaskForReview>[1]) =>
        withClient((client) => submitTaskForReview(client, input)),
      approveReview: (input: Parameters<typeof approveTaskReview>[1]) =>
        withClient((client) => approveTaskReview(client, input)),
      returnReview: (input: Parameters<typeof returnTaskReview>[1]) =>
        withClient((client) => returnTaskReview(client, input)),
    }),
    [withClient],
  )

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>
}
