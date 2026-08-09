import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Link, useParams } from 'react-router'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { Button } from '@/components/ui/Button'
import { DateDisplay } from '@/components/ui/DateDisplay'
import { Dialog } from '@/components/ui/Dialog'
import { ProjectStatusBadge } from '@/features/projects/ProjectStatusBadge'
import { ProjectModulesSection } from '@/features/projects/ProjectModulesSection'
import { projectTypeLabels } from '@/features/projects/projectMeta'
import {
  useProjects,
  type Project,
  type ProjectMember,
} from '@/features/projects'
import { createSafeProjectError } from '@/features/projects/errors'
import { useWorkspace } from '@/features/workspaces'

export function ProjectDetailPage() {
  const { projectId = '' } = useParams()
  const workspace = useWorkspace()
  const projects = useProjects()
  const currentWorkspace = workspace.currentWorkspace
  const [project, setProject] = useState<Project | null>(null)
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [isArchiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const requestEpochRef = useRef(0)
  const actionEpochRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestEpochRef.current += 1
      actionEpochRef.current += 1
    }
  }, [])

  // Stable request-scope key: workspace + role + project id. The role is part
  // of the scope so a permission change (owner/admin -> member, or the reverse)
  // discards the previously read detail and re-verifies under the new context
  // instead of briefly keeping an owner/admin-authorised view on screen.
  const scopeKey = currentWorkspace
    ? `${currentWorkspace.workspace_id}:${currentWorkspace.role}:${projectId}`
    : null
  const scopeKeyRef = useRef(scopeKey)
  // A scope transition (workspace / role / project) must also invalidate any
  // in-flight mutation. Without this, an A -> B -> A cycle leaves the string
  // scope identical to the one that launched the original request, so the stale
  // response would pass the `actionScopeKey === scopeKeyRef.current` check and
  // be applied. Bumping the monotonically increasing action epoch on every
  // transition makes the original epoch stale regardless of how the scope
  // string evolves. Reading `requestEpochRef` (loads) and writing
  // `actionEpochRef` (mutations) remain independent.
  useLayoutEffect(() => {
    if (scopeKeyRef.current !== scopeKey) {
      actionEpochRef.current += 1
      scopeKeyRef.current = scopeKey
    }
  }, [scopeKey])

  // A scope change (workspace, role, or project) must reset the archive UI so
  // stale dialog/feedback/loading never leaks into the new scope. We reset
  // during render (the documented "reset when a key changes" pattern): the
  // committed scope key is a state, so comparing it to the current scope key is
  // a pure render-time check with no ref access and no effect body. Stale
  // responses are discarded by the archive handler's scope/epoch guard instead.
  const [committedScopeKey, setCommittedScopeKey] = useState(scopeKey)
  if (committedScopeKey !== scopeKey) {
    setCommittedScopeKey(scopeKey)
    setArchiveOpen(false)
    setArchiveError(null)
    setFeedback(null)
    setArchiving(false)
  }

  const canManage =
    currentWorkspace?.role === 'owner' || currentWorkspace?.role === 'admin'

  const loadProject = useCallback(async () => {
    if (!currentWorkspace) return
    const epoch = ++requestEpochRef.current
    const requestScopeKey = scopeKeyRef.current
    setLoadState('loading')
    setLoadedScopeKey(null)
    const [result, membersResult] = await Promise.all([
      projects.get(projectId),
      projects.listMembers(projectId),
    ])
    if (!mountedRef.current || requestEpochRef.current !== epoch) return
    if (requestScopeKey !== scopeKeyRef.current) return
    if (
      !result.ok ||
      !membersResult.ok ||
      (projectId !== '' && result.data.project_id !== projectId) ||
      result.data.workspace_id !== currentWorkspace.workspace_id ||
      membersResult.data.some(
        (member) =>
          (projectId !== '' && member.project_id !== projectId) ||
          member.workspace_id !== currentWorkspace.workspace_id,
      )
    ) {
      setProject(null)
      setProjectMembers([])
      setLoadedScopeKey(requestScopeKey)
      setLoadState('error')
      return
    }
    setProject(result.data)
    setProjectMembers(membersResult.data)
    setLoadedScopeKey(requestScopeKey)
    setLoadState('ready')
  }, [currentWorkspace, projectId, projects])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void loadProject()
    })
    return () => {
      cancelled = true
      requestEpochRef.current += 1
    }
  }, [loadProject])

  const archive = async () => {
    if (!project || isArchiving) return
    // Capture the submitting context so a later response can only be applied if
    // the scope is still identical and the action epoch is still current.
    const actionScopeKey = scopeKeyRef.current
    const actionProjectId = project.project_id
    const actionUpdatedAt = project.updated_at
    const actionWorkspaceId = currentWorkspace?.workspace_id
    const actionEpoch = ++actionEpochRef.current
    setArchiving(true)
    setArchiveError(null)
    const result = await projects.archive(actionProjectId, actionUpdatedAt)
    if (!mountedRef.current) return
    if (actionEpochRef.current !== actionEpoch) return
    if (actionScopeKey !== scopeKeyRef.current) return
    const stillCanManage =
      currentWorkspace?.role === 'owner' || currentWorkspace?.role === 'admin'
    if (!stillCanManage) return
    if (!result.ok) {
      setArchiveError(result.error.message)
      setArchiving(false)
      return
    }
    // The server may have succeeded; only apply it when the response belongs to
    // the exact project and workspace that initiated the request. A mismatched
    // entity is a safe-failure: close the loading state and surface a unified
    // message instead of leaving the dialog stuck on "正在归档" or writing a
    // wrong project onto the screen.
    if (
      result.data.project_id !== actionProjectId ||
      result.data.workspace_id !== actionWorkspaceId
    ) {
      setArchiving(false)
      setArchiveError(createSafeProjectError('unknown_service_error').message)
      return
    }
    setProject(result.data)
    setArchiveOpen(false)
    setArchiving(false)
    setFeedback('项目已归档，不会被物理删除。')
  }

  if (!currentWorkspace) return null

  // A ready/error payload is only trustworthy inside the scope that produced
  // it. When the scope key no longer matches, fall back to the loading state
  // until the in-flight request for the current scope resolves.
  const staleScope = loadedScopeKey !== scopeKey
  const showLoading = loadState === 'loading' || staleScope

  if (showLoading) {
    return <LoadingState title="正在加载项目详情" />
  }
  if (loadState === 'error' || !project) {
    return (
      <ErrorState
        action={
          <Link className="text-link" to="/projects">
            返回项目列表
          </Link>
        }
        description="项目不存在或你无权访问。"
        title="无法打开项目"
      />
    )
  }

  const currentProjectMember = projectMembers.find(
    (member) => member.is_current_user,
  )
  const canManageMembers =
    project.status !== 'archived' &&
    (canManage ||
      currentProjectMember?.project_role === 'owner' ||
      currentProjectMember?.project_role === 'lead')

  const activeMemberCount = projectMembers[0]?.active_member_count ?? 0
  const inactiveHistoricalMemberCount =
    projectMembers[0]?.inactive_historical_member_count ?? 0

  return (
    <div className="page-stack project-detail-page">
      <section className="intro project-detail-heading">
        <div>
          <p className="eyebrow">{projectTypeLabels[project.project_type]}</p>
          <h2>{project.name}</h2>
          <div className="project-heading-status">
            <ProjectStatusBadge status={project.status} />
          </div>
        </div>
        <div className="project-detail-actions">
          <Link className="button button-secondary button-md" to="/projects">
            返回列表
          </Link>
          {canManage && project.status !== 'archived' && (
            <Link
              className="button button-secondary button-md"
              to={`/projects/${project.project_id}/edit`}
            >
              编辑项目
            </Link>
          )}
          {canManage && project.status === 'completed' && (
            <Button onClick={() => setArchiveOpen(true)} variant="danger">
              归档项目
            </Button>
          )}
        </div>
      </section>

      {feedback && (
        <p aria-live="polite" className="confirmation" role="status">
          {feedback}{' '}
          <Link className="text-link" to="/projects?view=archived">
            查看已归档项目
          </Link>
        </p>
      )}

      <section className="project-detail-card">
        <h3>项目概览</h3>
        <p className="project-description">
          {project.description ?? '暂未填写项目描述。'}
        </p>
        <dl className="project-detail-grid">
          <div>
            <dt>项目负责人</dt>
            <dd>{project.owner_display_name}</dd>
          </div>
          <div>
            <dt>项目牵头人</dt>
            <dd>{project.lead_display_name ?? '暂未设置'}</dd>
          </div>
          <div>
            <dt>项目成员</dt>
            <dd>
              {activeMemberCount} 人
              {inactiveHistoricalMemberCount > 0
                ? `；停用历史 ${inactiveHistoricalMemberCount} 人`
                : ''}
            </dd>
          </div>
          <div>
            <dt>开始日期</dt>
            <dd>
              <DateDisplay value={project.start_date} />
            </dd>
          </div>
          <div>
            <dt>截止日期</dt>
            <dd>
              <DateDisplay value={project.due_date} />
            </dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>
              <DateDisplay kind="date-time" value={project.created_at} />
            </dd>
          </div>
          <div>
            <dt>更新时间</dt>
            <dd>
              <DateDisplay kind="date-time" value={project.updated_at} />
            </dd>
          </div>
          <div>
            <dt>归档时间</dt>
            <dd>
              <DateDisplay kind="date-time" value={project.archived_at} />
            </dd>
          </div>
        </dl>
      </section>

      <section className="project-future-grid" aria-label="后续项目能力">
        <article className="card">
          <h3>项目成员</h3>
          <p>
            当前共 {activeMemberCount} 人
            {inactiveHistoricalMemberCount > 0
              ? `；停用历史 ${inactiveHistoricalMemberCount} 人`
              : ''}
            ；负责人为
            {project.owner_display_name}，牵头人为
            {project.lead_display_name ?? '暂未设置'}。
          </p>
          <Link
            className="button button-secondary button-md"
            to={`/projects/${project.project_id}/members`}
          >
            {canManageMembers ? '管理项目成员' : '查看项目成员'}
          </Link>
        </article>
        <article className="card">
          <h3>项目任务</h3>
          <p>
            Task 3.1
            提供任务创建、详情深链和核心元数据编辑；任务列表与看板将在后续任务中实现。
          </p>
          {canManageMembers ? (
            <Link
              className="button button-primary button-md"
              to={`/projects/${project.project_id}/tasks/new`}
            >
              创建任务
            </Link>
          ) : (
            <p className="muted-text">
              已知任务链接可按任务可见性直接打开；当前版本不提供任务列表。
            </p>
          )}
        </article>
      </section>

      <ProjectModulesSection
        canManage={canManageMembers}
        key={scopeKey ?? project.project_id}
        project={project}
      />

      <Dialog
        confirmDisabled={isArchiving}
        confirmLabel={isArchiving ? '正在归档' : '确认归档'}
        confirmLoading={isArchiving}
        danger
        description="归档后项目会从默认列表隐藏，但项目和成员关系不会被物理删除；本任务不支持取消归档。"
        onClose={() => {
          if (!isArchiving) {
            setArchiveOpen(false)
            setArchiveError(null)
          }
        }}
        onConfirm={() => void archive()}
        open={archiveOpen}
        title="归档项目"
      >
        {archiveError && (
          <p className="form-error" role="alert">
            {archiveError}
          </p>
        )}
      </Dialog>
    </div>
  )
}
