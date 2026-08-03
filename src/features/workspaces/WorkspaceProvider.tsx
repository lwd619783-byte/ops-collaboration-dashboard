import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import { useAuth } from '@/features/auth'
import { createSafeWorkspaceError } from '@/features/workspaces/errors'
import {
  acceptWorkspaceInvitation,
  inviteWorkspaceMember,
  listMyPendingWorkspaceInvitations,
  listMyWorkspaces,
  listWorkspaceMembers,
  setWorkspaceMemberRole,
  setWorkspaceMemberStatus,
} from '@/features/workspaces/workspaceService'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
  type WorkspaceLoadStatus,
} from '@/features/workspaces/WorkspaceContext'
import type {
  PendingWorkspaceInvitation,
  WorkspaceSummary,
} from '@/features/workspaces/types'
import {
  getSupabaseClient,
  type SupabaseClientResolution,
} from '@/lib/supabase/client'

type WorkspaceProviderProps = PropsWithChildren<{
  resolveClient?: () => SupabaseClientResolution
}>

export function WorkspaceProvider({
  children,
  resolveClient = getSupabaseClient,
}: WorkspaceProviderProps) {
  const { status: authStatus } = useAuth()
  const [status, setStatus] = useState<WorkspaceLoadStatus>('idle')
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [pendingInvitations, setPendingInvitations] = useState<
    PendingWorkspaceInvitation[]
  >([])
  const [error, setError] = useState<WorkspaceContextValue['error']>(null)
  const requestEpochRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestEpochRef.current += 1
    }
  }, [])

  const refresh = useCallback(async () => {
    if (authStatus !== 'authenticated_authorized') return
    requestEpochRef.current += 1
    const epoch = requestEpochRef.current
    setStatus('loading')
    setError(null)

    const resolution = resolveClient()
    if (resolution.status !== 'ready') {
      if (mountedRef.current && requestEpochRef.current === epoch) {
        setWorkspaces([])
        setPendingInvitations([])
        setError(createSafeWorkspaceError('configuration_unavailable'))
        setStatus('error')
      }
      return
    }

    const [workspaceResult, invitationResult] = await Promise.all([
      listMyWorkspaces(resolution.client),
      listMyPendingWorkspaceInvitations(resolution.client),
    ])
    if (!mountedRef.current || requestEpochRef.current !== epoch) return

    if (!workspaceResult.ok) {
      setWorkspaces([])
      setPendingInvitations([])
      setError(workspaceResult.error)
      setStatus('error')
      return
    }
    if (!invitationResult.ok) {
      setWorkspaces([])
      setPendingInvitations([])
      setError(invitationResult.error)
      setStatus('error')
      return
    }

    setWorkspaces(workspaceResult.data)
    setPendingInvitations(invitationResult.data)
    setStatus('ready')
  }, [authStatus, resolveClient])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      if (authStatus === 'authenticated_authorized') {
        void refresh()
        return
      }
      requestEpochRef.current += 1
      setStatus('idle')
      setWorkspaces([])
      setPendingInvitations([])
      setError(null)
    })
    return () => {
      cancelled = true
    }
  }, [authStatus, refresh])

  const withClient = useCallback(
    <T,>(
      operation: (
        client: Extract<
          SupabaseClientResolution,
          { status: 'ready' }
        >['client'],
      ) => Promise<T>,
      fallback: T,
    ): Promise<T> => {
      const resolution = resolveClient()
      if (resolution.status !== 'ready') return Promise.resolve(fallback)
      return operation(resolution.client)
    },
    [resolveClient],
  )

  const configurationFallback = useCallback(
    () => ({
      ok: false as const,
      error: createSafeWorkspaceError('configuration_unavailable'),
    }),
    [],
  )

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      status,
      workspaces,
      currentWorkspace: workspaces[0] ?? null,
      pendingInvitations,
      error,
      refresh,
      listMembers: (workspaceId) =>
        withClient(
          (client) => listWorkspaceMembers(client, workspaceId),
          configurationFallback(),
        ),
      inviteMember: (input) =>
        withClient(
          (client) => inviteWorkspaceMember(client, input),
          configurationFallback(),
        ),
      setMemberRole: (workspaceId, userId, role) =>
        withClient(
          (client) => setWorkspaceMemberRole(client, workspaceId, userId, role),
          configurationFallback(),
        ),
      setMemberStatus: (workspaceId, userId, memberStatus) =>
        withClient(
          (client) =>
            setWorkspaceMemberStatus(client, workspaceId, userId, memberStatus),
          configurationFallback(),
        ),
      acceptInvitation: (invitationId) =>
        withClient(
          (client) => acceptWorkspaceInvitation(client, invitationId),
          configurationFallback(),
        ),
    }),
    [
      configurationFallback,
      error,
      pendingInvitations,
      refresh,
      status,
      withClient,
      workspaces,
    ],
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}
