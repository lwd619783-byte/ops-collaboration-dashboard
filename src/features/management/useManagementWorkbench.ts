import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useProjects, type Project } from '@/features/projects'
import {
  buildManagementWorkbenchSnapshot,
  selectManageableProjects,
  type ManagementProjectTaskLoad,
} from '@/features/management/managementWorkbench'
import { useTasks } from '@/features/tasks'
import { currentLocalCalendarDate } from '@/features/tasks/validation'
import type { WorkspaceRole } from '@/features/workspaces'

export const MANAGEMENT_TASK_LOAD_CONCURRENCY = 4

export type ManagementWorkbenchScope = {
  appUserId: string
  workspaceId: string
  workspaceRole: WorkspaceRole
}

type ManagementWorkbenchData = {
  projects: Project[]
  taskLoads: Map<string, ManagementProjectTaskLoad>
  calculatedAt: Date
}

export type ManagementWorkbenchState = {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  snapshot: ReturnType<typeof buildManagementWorkbenchSnapshot> | null
  isRetryingPartial: boolean
  retry: () => void
  retryPartial: () => void
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('并发上限必须是正整数。')
  }
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  }
  const workerCount = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

function taskLoadError(message: string): ManagementProjectTaskLoad {
  return { status: 'error', error: message }
}

export function useManagementWorkbench(
  scope: ManagementWorkbenchScope | null,
): ManagementWorkbenchState {
  const projectsService = useProjects()
  const tasksService = useTasks()
  const appUserId = scope?.appUserId ?? null
  const workspaceId = scope?.workspaceId ?? null
  const workspaceRole = scope?.workspaceRole ?? null
  const scopeKey =
    appUserId && workspaceId && workspaceRole
      ? `${appUserId}:${workspaceId}:${workspaceRole}`
      : null
  const scopeKeyRef = useRef(scopeKey)
  const requestEpochRef = useRef(0)
  const mountedRef = useRef(true)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ManagementWorkbenchData | null>(null)
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [isRetryingPartial, setRetryingPartial] = useState(false)

  useLayoutEffect(() => {
    scopeKeyRef.current = scopeKey
  }, [scopeKey])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestEpochRef.current += 1
    }
  }, [])

  const requestIsCurrent = useCallback(
    (epoch: number, requestScopeKey: string) =>
      mountedRef.current &&
      requestEpochRef.current === epoch &&
      scopeKeyRef.current === requestScopeKey,
    [],
  )

  const loadProjectTasks = useCallback(
    async (
      projects: readonly Project[],
      epoch: number,
      requestScopeKey: string,
      requestWorkspaceId: string,
    ) => {
      const entries = await mapWithConcurrency(
        projects,
        MANAGEMENT_TASK_LOAD_CONCURRENCY,
        async (
          project,
        ): Promise<readonly [string, ManagementProjectTaskLoad]> => {
          if (!requestIsCurrent(epoch, requestScopeKey)) {
            return [
              project.project_id,
              taskLoadError('项目任务数据暂时无法读取。'),
            ]
          }
          const result = await tasksService.list({
            projectId: project.project_id,
            workspaceId: requestWorkspaceId,
          })
          if (!result.ok) {
            return [project.project_id, taskLoadError(result.error.message)]
          }
          if (
            result.data.some(
              (task) =>
                task.project_id !== project.project_id ||
                task.workspace_id !== requestWorkspaceId,
            )
          ) {
            return [
              project.project_id,
              taskLoadError('项目任务数据暂时无法读取。'),
            ]
          }
          return [project.project_id, { status: 'ready', tasks: result.data }]
        },
      )
      return new Map<string, ManagementProjectTaskLoad>(entries)
    },
    [requestIsCurrent, tasksService],
  )

  useEffect(() => {
    if (!appUserId || !workspaceId || !workspaceRole || !scopeKey) return
    let cancelled = false
    const epoch = ++requestEpochRef.current
    const requestScopeKey = scopeKey

    queueMicrotask(() => {
      if (cancelled) return
      setStatus('loading')
      setError(null)
      setData(null)
      setLoadedScopeKey(null)
      setRetryingPartial(false)
      void projectsService
        .list({ workspaceId, archivedOnly: false })
        .then(async (result) => {
          if (cancelled || !requestIsCurrent(epoch, requestScopeKey)) return
          if (!result.ok) {
            setError(result.error.message)
            setLoadedScopeKey(requestScopeKey)
            setStatus('error')
            return
          }
          const projectIds = new Set<string>()
          const invalidProjects = result.data.some((project) => {
            if (
              project.workspace_id !== workspaceId ||
              projectIds.has(project.project_id)
            ) {
              return true
            }
            projectIds.add(project.project_id)
            return false
          })
          if (invalidProjects) {
            setError('项目列表暂时无法用于管理工作台，请稍后重试。')
            setLoadedScopeKey(requestScopeKey)
            setStatus('error')
            return
          }
          const manageableProjects = selectManageableProjects(
            result.data,
            workspaceRole,
            appUserId,
          )
          const taskLoads = await loadProjectTasks(
            manageableProjects,
            epoch,
            requestScopeKey,
            workspaceId,
          )
          if (cancelled || !requestIsCurrent(epoch, requestScopeKey)) return
          setData({
            projects: manageableProjects,
            taskLoads,
            calculatedAt: new Date(),
          })
          setLoadedScopeKey(requestScopeKey)
          setStatus('ready')
        })
    })

    return () => {
      cancelled = true
      requestEpochRef.current += 1
    }
  }, [
    appUserId,
    loadProjectTasks,
    projectsService,
    reloadToken,
    requestIsCurrent,
    scopeKey,
    workspaceId,
    workspaceRole,
  ])

  const retry = useCallback(() => {
    setReloadToken((current) => current + 1)
  }, [])

  const retryPartial = useCallback(() => {
    if (
      !data ||
      !scopeKey ||
      !workspaceId ||
      isRetryingPartial ||
      loadedScopeKey !== scopeKey
    ) {
      return
    }
    const failedProjects = data.projects.filter(
      (project) => data.taskLoads.get(project.project_id)?.status === 'error',
    )
    if (failedProjects.length === 0) return
    const epoch = ++requestEpochRef.current
    const requestScopeKey = scopeKey
    setRetryingPartial(true)
    void loadProjectTasks(
      failedProjects,
      epoch,
      requestScopeKey,
      workspaceId,
    ).then((retriedLoads) => {
      if (!requestIsCurrent(epoch, requestScopeKey)) return
      setData((current) => {
        if (!current) return current
        const taskLoads = new Map(current.taskLoads)
        for (const [projectId, load] of retriedLoads) {
          taskLoads.set(projectId, load)
        }
        return { ...current, taskLoads, calculatedAt: new Date() }
      })
      setRetryingPartial(false)
    })
  }, [
    data,
    isRetryingPartial,
    loadProjectTasks,
    loadedScopeKey,
    requestIsCurrent,
    scopeKey,
    workspaceId,
  ])

  const snapshot = useMemo(() => {
    if (!data) return null
    return buildManagementWorkbenchSnapshot(
      data.projects,
      data.taskLoads,
      currentLocalCalendarDate(data.calculatedAt),
      data.calculatedAt,
    )
  }, [data])

  if (loadedScopeKey !== scopeKey) {
    return {
      status: 'loading',
      error: null,
      snapshot: null,
      isRetryingPartial: false,
      retry,
      retryPartial,
    }
  }
  return { status, error, snapshot, isRetryingPartial, retry, retryPartial }
}
