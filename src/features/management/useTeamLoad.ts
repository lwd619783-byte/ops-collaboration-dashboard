import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { mapWithConcurrency } from '@/features/management/useManagementWorkbench'
import {
  buildTeamLoadSnapshot,
  isTeamLoadExecutionTask,
  type TeamLoadProjectBundleLoad,
} from '@/features/management/teamLoad'
import { selectManageableProjects } from '@/features/management/managementWorkbench'
import { useProjects, type Project } from '@/features/projects'
import { useTasks } from '@/features/tasks'
import { currentLocalCalendarDate } from '@/features/tasks/validation'
import type { WorkspaceRole } from '@/features/workspaces'

export const TEAM_LOAD_PROJECT_BUNDLE_CONCURRENCY = 4

export type TeamLoadScope = {
  appUserId: string
  workspaceId: string
  workspaceRole: WorkspaceRole
}

type TeamLoadData = {
  projects: Project[]
  bundleLoads: Map<string, TeamLoadProjectBundleLoad>
  calculatedAt: Date
}

export type TeamLoadState = {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  snapshot: ReturnType<typeof buildTeamLoadSnapshot> | null
  isRetryingPartial: boolean
  retry: () => void
  retryPartial: () => void
}

function bundleError(message: string): TeamLoadProjectBundleLoad {
  return { status: 'error', error: message }
}

function validateBundle(
  project: Project,
  workspaceId: string,
  tasks: Awaited<ReturnType<ReturnType<typeof useTasks>['list']>>,
  members: Awaited<ReturnType<ReturnType<typeof useProjects>['listMembers']>>,
): TeamLoadProjectBundleLoad {
  if (!tasks.ok || !members.ok) {
    return bundleError(
      !tasks.ok ? tasks.error.message : members.ok ? '' : members.error.message,
    )
  }

  const taskIds = new Set<string>()
  const invalidTask = tasks.data.some((task) => {
    if (
      task.project_id !== project.project_id ||
      task.workspace_id !== workspaceId ||
      taskIds.has(task.task_id)
    ) {
      return true
    }
    taskIds.add(task.task_id)
    return false
  })
  const memberIds = new Set<string>()
  const invalidMember = members.data.some((member) => {
    if (
      member.project_id !== project.project_id ||
      member.workspace_id !== workspaceId ||
      memberIds.has(member.app_user_id)
    ) {
      return true
    }
    memberIds.add(member.app_user_id)
    return false
  })
  const activeMemberIds = new Set(
    members.data
      .filter((member) => member.is_active)
      .map((member) => member.app_user_id),
  )
  const orphanExecutionAssignee = tasks.data.some(
    (task) =>
      isTeamLoadExecutionTask(task) && !activeMemberIds.has(task.assignee_id),
  )

  if (invalidTask || invalidMember || orphanExecutionAssignee) {
    return bundleError('项目成员或任务数据暂时无法用于团队负荷汇总。')
  }
  return { status: 'ready', tasks: tasks.data, members: members.data }
}

export function useTeamLoad(scope: TeamLoadScope | null): TeamLoadState {
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
  const [data, setData] = useState<TeamLoadData | null>(null)
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

  const loadBundles = useCallback(
    async (
      projects: readonly Project[],
      epoch: number,
      requestScopeKey: string,
      requestWorkspaceId: string,
    ) => {
      const entries = await mapWithConcurrency(
        projects,
        TEAM_LOAD_PROJECT_BUNDLE_CONCURRENCY,
        async (
          project,
        ): Promise<readonly [string, TeamLoadProjectBundleLoad]> => {
          if (!requestIsCurrent(epoch, requestScopeKey)) {
            return [project.project_id, bundleError('项目数据读取已取消。')]
          }
          const [tasks, members] = await Promise.all([
            tasksService.list({
              projectId: project.project_id,
              workspaceId: requestWorkspaceId,
            }),
            projectsService.listMembers(project.project_id),
          ])
          return [
            project.project_id,
            validateBundle(project, requestWorkspaceId, tasks, members),
          ]
        },
      )
      return new Map<string, TeamLoadProjectBundleLoad>(entries)
    },
    [projectsService, requestIsCurrent, tasksService],
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
            setError('项目列表暂时无法用于团队负荷汇总，请稍后重试。')
            setLoadedScopeKey(requestScopeKey)
            setStatus('error')
            return
          }
          const manageableProjects = selectManageableProjects(
            result.data,
            workspaceRole,
            appUserId,
          )
          const bundleLoads = await loadBundles(
            manageableProjects,
            epoch,
            requestScopeKey,
            workspaceId,
          )
          if (cancelled || !requestIsCurrent(epoch, requestScopeKey)) return
          setData({
            projects: manageableProjects,
            bundleLoads,
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
    loadBundles,
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
      (project) => data.bundleLoads.get(project.project_id)?.status === 'error',
    )
    if (failedProjects.length === 0) return
    const epoch = ++requestEpochRef.current
    const requestScopeKey = scopeKey
    setRetryingPartial(true)
    void loadBundles(failedProjects, epoch, requestScopeKey, workspaceId).then(
      (retriedLoads) => {
        if (!requestIsCurrent(epoch, requestScopeKey)) return
        setData((current) => {
          if (!current) return current
          const bundleLoads = new Map(current.bundleLoads)
          for (const [projectId, load] of retriedLoads) {
            bundleLoads.set(projectId, load)
          }
          return { ...current, bundleLoads, calculatedAt: new Date() }
        })
        setRetryingPartial(false)
      },
    )
  }, [
    data,
    isRetryingPartial,
    loadBundles,
    loadedScopeKey,
    requestIsCurrent,
    scopeKey,
    workspaceId,
  ])

  const snapshot = useMemo(() => {
    if (!data) return null
    return buildTeamLoadSnapshot(
      data.projects,
      data.bundleLoads,
      currentLocalCalendarDate(data.calculatedAt),
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
