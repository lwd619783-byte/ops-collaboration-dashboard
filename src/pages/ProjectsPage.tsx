import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, useSearchParams } from 'react-router'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { InputField } from '@/components/forms/InputField'
import { SelectField } from '@/components/forms/SelectField'
import { Button } from '@/components/ui/Button'
import { DateDisplay } from '@/components/ui/DateDisplay'
import { ProjectStatusBadge } from '@/features/projects/ProjectStatusBadge'
import {
  projectStatusLabels,
  projectTypeLabels,
} from '@/features/projects/projectMeta'
import {
  useProjects,
  type Project,
  type ProjectStatus,
} from '@/features/projects'
import { useWorkspace } from '@/features/workspaces'

const currentStatuses: Exclude<ProjectStatus, 'archived'>[] = [
  'planning',
  'active',
  'paused',
  'completed',
]

export function ProjectsPage() {
  const workspace = useWorkspace()
  const projectsService = useProjects()
  const currentWorkspace = workspace.currentWorkspace
  const [searchParams, setSearchParams] = useSearchParams()
  const archivedOnly = searchParams.get('view') === 'archived'
  const [projects, setProjects] = useState<Project[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ProjectStatus | ''>('')
  const requestEpochRef = useRef(0)
  const mountedRef = useRef(true)

  // Stable request-scope key. Ready data is only ever shown when the key that
  // produced it still equals the key for the current render, so switching the
  // workspace or the archived/current view can never keep stale projects on
  // screen while the next request is still in flight.
  const scopeKey = currentWorkspace
    ? `${currentWorkspace.workspace_id}:${archivedOnly ? 'archived' : 'current'}`
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

  const canManage =
    currentWorkspace?.role === 'owner' || currentWorkspace?.role === 'admin'

  const loadProjects = useCallback(async () => {
    if (!currentWorkspace) return
    const epoch = ++requestEpochRef.current
    const requestScopeKey = scopeKeyRef.current
    setLoadState('loading')
    setLoadedScopeKey(null)
    setLoadError(null)
    const result = await projectsService.list({
      workspaceId: currentWorkspace.workspace_id,
      archivedOnly,
    })
    if (!mountedRef.current || requestEpochRef.current !== epoch) return
    // The scope may have changed while this request was in flight. Drop the
    // result rather than letting stale projects surface under the new scope.
    if (requestScopeKey !== scopeKeyRef.current) return
    if (!result.ok) {
      setProjects([])
      setLoadError(result.error.message)
      setLoadedScopeKey(requestScopeKey)
      setLoadState('error')
      return
    }
    setProjects(result.data)
    setLoadedScopeKey(requestScopeKey)
    setLoadState('ready')
  }, [archivedOnly, currentWorkspace, projectsService])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void loadProjects()
    })
    return () => {
      cancelled = true
      // Invalidate any in-flight request from the previous scope immediately,
      // independent of whether the next request has already started.
      requestEpochRef.current += 1
    }
  }, [loadProjects])

  const effectiveStatus = archivedOnly
    ? status === 'archived'
      ? status
      : ''
    : status === 'archived'
      ? ''
      : status

  const filteredProjects = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('zh-CN')
    return projects.filter((project) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        `${project.name} ${project.description ?? ''}`
          .toLocaleLowerCase('zh-CN')
          .includes(normalizedSearch)
      const matchesStatus =
        effectiveStatus === '' || project.status === effectiveStatus
      return matchesSearch && matchesStatus
    })
  }, [effectiveStatus, projects, search])

  if (!currentWorkspace) return null

  // A ready/error payload is only trustworthy inside the scope that produced
  // it. When the scope key no longer matches, fall back to the loading state
  // until the in-flight request for the current scope resolves.
  const staleScope = loadedScopeKey !== scopeKey
  const showLoading = loadState === 'loading' || staleScope

  const setArchiveView = (nextArchived: boolean) => {
    setStatus('')
    setSearchParams(nextArchived ? { view: 'archived' } : {}, { replace: true })
  }

  return (
    <div className="page-stack projects-page">
      <section className="intro projects-heading">
        <div>
          <p className="eyebrow">{currentWorkspace.workspace_name}</p>
          <h2>{archivedOnly ? '已归档项目' : '当前项目'}</h2>
          <p>
            {archivedOnly
              ? '仅显示你有权访问的已归档项目。'
              : '项目列表按最后更新时间倒序排列。'}
          </p>
        </div>
        {canManage && (
          <Link className="button button-primary button-md" to="/projects/new">
            创建运维项目
          </Link>
        )}
      </section>

      <div aria-label="项目范围" className="segmented-control" role="group">
        <Button
          aria-pressed={!archivedOnly}
          onClick={() => setArchiveView(false)}
          variant={!archivedOnly ? 'primary' : 'secondary'}
        >
          当前项目
        </Button>
        <Button
          aria-pressed={archivedOnly}
          onClick={() => setArchiveView(true)}
          variant={archivedOnly ? 'primary' : 'secondary'}
        >
          已归档
        </Button>
      </div>

      <section aria-label="项目筛选" className="project-filters">
        <InputField
          label="搜索项目"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索名称或描述"
          type="search"
          value={search}
        />
        <SelectField
          label="状态筛选"
          onChange={(event) =>
            setStatus(event.target.value as ProjectStatus | '')
          }
          value={effectiveStatus}
        >
          <option value="">全部状态</option>
          {(archivedOnly ? (['archived'] as const) : currentStatuses).map(
            (projectStatus) => (
              <option key={projectStatus} value={projectStatus}>
                {projectStatusLabels[projectStatus]}
              </option>
            ),
          )}
        </SelectField>
      </section>

      {showLoading && <LoadingState title="正在加载项目" />}
      {!showLoading && loadState === 'error' && (
        <ErrorState
          action={
            <Button onClick={() => void loadProjects()} variant="secondary">
              重试
            </Button>
          }
          description={loadError ?? '项目列表暂时无法读取，请稍后重试。'}
          title="暂时无法加载项目"
        />
      )}
      {!showLoading &&
        loadState === 'ready' &&
        filteredProjects.length === 0 && (
          <EmptyState
            action={
              canManage &&
              !archivedOnly &&
              search.length === 0 &&
              effectiveStatus === '' ? (
                <Link className="text-link" to="/projects/new">
                  创建第一个运维项目
                </Link>
              ) : undefined
            }
            description={
              search.length > 0 || effectiveStatus !== ''
                ? '没有符合当前搜索和筛选条件的项目。'
                : archivedOnly
                  ? '当前没有你有权访问的已归档项目。'
                  : '当前工作空间还没有可显示的项目。'
            }
            title="暂无项目"
          />
        )}
      {!showLoading && loadState === 'ready' && filteredProjects.length > 0 && (
        <section aria-label="项目列表" className="project-card-list">
          {filteredProjects.map((project) => (
            <article className="project-card" key={project.project_id}>
              <div className="project-card-heading">
                <div>
                  <p className="project-type-label">
                    {projectTypeLabels[project.project_type]}
                  </p>
                  <h3>
                    <Link to={`/projects/${project.project_id}`}>
                      {project.name}
                    </Link>
                  </h3>
                </div>
                <ProjectStatusBadge status={project.status} />
              </div>
              <p className="project-card-description">
                {project.description ?? '暂未填写项目描述。'}
              </p>
              <dl className="project-card-meta">
                <div>
                  <dt>项目负责人</dt>
                  <dd>{project.owner_display_name}</dd>
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
                  <dt>最后更新</dt>
                  <dd>
                    <DateDisplay kind="date-time" value={project.updated_at} />
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
