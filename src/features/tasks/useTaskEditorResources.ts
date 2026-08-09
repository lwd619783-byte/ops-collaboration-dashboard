import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  useProjects,
  type Project,
  type ProjectModule,
} from '@/features/projects'
import { useAuth } from '@/features/auth'
import { useTasks } from '@/features/tasks/TaskContext'
import type { Task, TaskAssignmentCandidate } from '@/features/tasks/types'
import { useWorkspace } from '@/features/workspaces'

type TaskEditorResources = {
  project: Project
  modules: ProjectModule[]
  candidates: TaskAssignmentCandidate[]
  task: Task | null
}

export function useTaskEditorResources(projectId: string, taskId?: string) {
  const auth = useAuth()
  const projects = useProjects()
  const tasks = useTasks()
  const workspace = useWorkspace()
  const currentWorkspace = workspace.currentWorkspace
  const appUserId = auth.appUser?.id ?? null
  const [resources, setResources] = useState<TaskEditorResources | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const requestEpochRef = useRef(0)
  const scopeKey =
    currentWorkspace && appUserId
      ? `${appUserId}:${currentWorkspace.workspace_id}:${currentWorkspace.role}:${projectId}:${taskId ?? 'new'}`
      : null
  const scopeKeyRef = useRef(scopeKey)

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

  const load = useCallback(async () => {
    if (!appUserId || !currentWorkspace || !scopeKey) return
    const epoch = ++requestEpochRef.current
    const requestScopeKey = scopeKey
    setLoadState('loading')
    setLoadedScopeKey(null)
    const [projectResult, moduleResult, candidateResult, taskResult] =
      await Promise.all([
        projects.get(projectId),
        projects.listModules(projectId),
        tasks.listCandidates(projectId),
        taskId ? tasks.get(taskId) : Promise.resolve(null),
      ])
    if (!mountedRef.current || requestEpochRef.current !== epoch) return
    if (scopeKeyRef.current !== requestScopeKey) return
    const taskFailed = taskResult !== null && !taskResult.ok
    if (
      !projectResult.ok ||
      !moduleResult.ok ||
      !candidateResult.ok ||
      taskFailed
    ) {
      setResources(null)
      setLoadedScopeKey(requestScopeKey)
      setLoadState('error')
      return
    }
    const task = taskResult?.ok ? taskResult.data : null
    const invalidScope =
      projectResult.data.project_id !== projectId ||
      projectResult.data.workspace_id !== currentWorkspace.workspace_id ||
      moduleResult.data.some((module) => module.project_id !== projectId) ||
      candidateResult.data.some(
        (candidate) =>
          candidate.project_id !== projectId ||
          candidate.workspace_id !== currentWorkspace.workspace_id,
      ) ||
      (task !== null &&
        (task.task_id !== taskId ||
          task.project_id !== projectId ||
          task.workspace_id !== currentWorkspace.workspace_id))
    if (invalidScope) {
      setResources(null)
      setLoadedScopeKey(requestScopeKey)
      setLoadState('error')
      return
    }
    setResources({
      project: projectResult.data,
      modules: moduleResult.data,
      candidates: candidateResult.data,
      task,
    })
    setLoadedScopeKey(requestScopeKey)
    setLoadState('ready')
  }, [
    appUserId,
    currentWorkspace,
    projectId,
    projects,
    scopeKey,
    taskId,
    tasks,
  ])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void load()
    })
    return () => {
      cancelled = true
      requestEpochRef.current += 1
    }
  }, [load])

  return {
    load,
    loadState,
    resources,
    scopeKey,
    showLoading: loadState === 'loading' || loadedScopeKey !== scopeKey,
  }
}
