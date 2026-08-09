import { useCallback, useMemo, type PropsWithChildren } from 'react'
import { createSafeTaskError } from '@/features/tasks/errors'
import { TaskContext } from '@/features/tasks/TaskContext'
import {
  createTask,
  getTask,
  listProjectTasks,
  listTaskAssignmentCandidates,
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
      listCandidates: (projectId: string) =>
        withClient((client) => listTaskAssignmentCandidates(client, projectId)),
      create: (input: Parameters<typeof createTask>[1]) =>
        withClient((client) => createTask(client, input)),
      update: (input: Parameters<typeof updateTask>[1]) =>
        withClient((client) => updateTask(client, input)),
    }),
    [withClient],
  )

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>
}
