import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useTasks } from '@/features/tasks/TaskContext'
import type { MyTaskSummary } from '@/features/tasks/types'
import type { WorkspaceRole } from '@/features/workspaces'

export type MyTasksScope = {
  appUserId: string
  workspaceId: string
  workspaceRole: WorkspaceRole
}

type ScopedMyTasksState = {
  tasks: MyTaskSummary[]
  status: 'loading' | 'ready' | 'error'
  error: string | null
  retry: () => void
}

export function useScopedMyTasks(
  scope: MyTasksScope | null,
): ScopedMyTasksState {
  const service = useTasks()
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
  const [tasks, setTasks] = useState<MyTaskSummary[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

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

  useEffect(() => {
    if (!appUserId || !workspaceId || !scopeKey) return
    let cancelled = false
    const epoch = ++requestEpochRef.current
    const requestScopeKey = scopeKey

    queueMicrotask(() => {
      if (cancelled) return
      setStatus('loading')
      setError(null)
      setLoadedScopeKey(null)
      void service
        .listMine({
          appUserId,
          workspaceId,
        })
        .then((result) => {
          if (
            cancelled ||
            !mountedRef.current ||
            requestEpochRef.current !== epoch ||
            scopeKeyRef.current !== requestScopeKey
          ) {
            return
          }
          setLoadedScopeKey(requestScopeKey)
          if (!result.ok) {
            setTasks([])
            setError(result.error.message)
            setStatus('error')
            return
          }
          setTasks(result.data)
          setStatus('ready')
        })
    })

    return () => {
      cancelled = true
      requestEpochRef.current += 1
    }
  }, [appUserId, reloadToken, scopeKey, service, workspaceId])

  const retry = useCallback(() => {
    setReloadToken((value) => value + 1)
  }, [])

  if (loadedScopeKey !== scopeKey) {
    return { tasks: [], status: 'loading', error: null, retry }
  }
  return { tasks, status, error, retry }
}
