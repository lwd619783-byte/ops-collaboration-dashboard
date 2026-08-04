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
import { projectTypeLabels } from '@/features/projects/projectMeta'
import { useProjects, type Project } from '@/features/projects'
import { useWorkspace } from '@/features/workspaces'

export function ProjectDetailPage() {
  const { projectId = '' } = useParams()
  const workspace = useWorkspace()
  const projects = useProjects()
  const currentWorkspace = workspace.currentWorkspace
  const [project, setProject] = useState<Project | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [isArchiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const requestEpochRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestEpochRef.current += 1
    }
  }, [])

  // Stable request-scope key: workspace + project id. Switching the route
  // parameter (project A -> project B) or the workspace must discard the old
  // detail before the next request resolves.
  const scopeKey = currentWorkspace
    ? `${currentWorkspace.workspace_id}:${projectId}`
    : null
  const scopeKeyRef = useRef(scopeKey)
  useLayoutEffect(() => {
    scopeKeyRef.current = scopeKey
  }, [scopeKey])

  const canManage =
    currentWorkspace?.role === 'owner' || currentWorkspace?.role === 'admin'

  const loadProject = useCallback(async () => {
    if (!currentWorkspace) return
    const epoch = ++requestEpochRef.current
    const requestScopeKey = scopeKeyRef.current
    setLoadState('loading')
    setLoadedScopeKey(null)
    const result = await projects.get(projectId)
    if (!mountedRef.current || requestEpochRef.current !== epoch) return
    if (requestScopeKey !== scopeKeyRef.current) return
    if (
      !result.ok ||
      result.data.workspace_id !== currentWorkspace.workspace_id
    ) {
      setProject(null)
      setLoadedScopeKey(requestScopeKey)
      setLoadState('error')
      return
    }
    setProject(result.data)
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
    setArchiving(true)
    setArchiveError(null)
    const result = await projects.archive(
      project.project_id,
      project.updated_at,
    )
    if (!result.ok) {
      setArchiveError(result.error.message)
      setArchiving(false)
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
          <p>成员添加、移除和角色管理将在 Task 2.2 开放。</p>
        </article>
        <article className="card">
          <h3>项目模块</h3>
          <p>运维项目预设模块将在 Task 2.3 开放。</p>
        </article>
      </section>

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
