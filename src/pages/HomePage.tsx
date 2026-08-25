import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { Button } from '@/components/ui/Button'
import { DateDisplay } from '@/components/ui/DateDisplay'
import { useAuth } from '@/features/auth'
import {
  ProjectStatusBadge,
  type Project,
  useProjects,
} from '@/features/projects'
import {
  isMyTaskActionable,
  MyTaskCard,
  sortMyTasks,
  useScopedMyTasks,
} from '@/features/tasks'
import { useWorkspace } from '@/features/workspaces'

export function HomePage() {
  const { appUser } = useAuth()
  const { currentWorkspace } = useWorkspace()
  const projectsService = useProjects()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectStatus, setProjectStatus] = useState<
    'loading' | 'ready' | 'error'
  >('loading')
  const [projectError, setProjectError] = useState<string | null>(null)
  const [projectLoadedScope, setProjectLoadedScope] = useState<string | null>(
    null,
  )
  const projectEpochRef = useRef(0)
  const mountedRef = useRef(true)
  const appUserId = appUser?.id ?? null
  const workspaceId = currentWorkspace?.workspace_id ?? null
  const workspaceRole = currentWorkspace?.role ?? null
  const projectScopeKey =
    appUserId && workspaceId && workspaceRole
      ? `${appUserId}:${workspaceId}:${workspaceRole}`
      : null
  const projectScopeRef = useRef(projectScopeKey)

  const taskState = useScopedMyTasks(
    appUserId && workspaceId && workspaceRole
      ? { appUserId, workspaceId, workspaceRole }
      : null,
  )

  useLayoutEffect(() => {
    projectScopeRef.current = projectScopeKey
  }, [projectScopeKey])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      projectEpochRef.current += 1
    }
  }, [])

  const loadProjects = useCallback(async () => {
    if (!workspaceId || !projectScopeKey) return
    const epoch = ++projectEpochRef.current
    const requestScope = projectScopeKey
    setProjectStatus('loading')
    setProjectError(null)
    setProjectLoadedScope(null)
    const result = await projectsService.list({
      workspaceId,
      archivedOnly: false,
    })
    if (
      !mountedRef.current ||
      projectEpochRef.current !== epoch ||
      projectScopeRef.current !== requestScope
    ) {
      return
    }
    setProjectLoadedScope(requestScope)
    if (
      !result.ok ||
      result.data.some((project) => project.workspace_id !== workspaceId)
    ) {
      setProjects([])
      setProjectError(
        result.ok
          ? '项目服务返回了不属于当前工作空间的数据。'
          : result.error.message,
      )
      setProjectStatus('error')
      return
    }
    setProjects(result.data)
    setProjectStatus('ready')
  }, [projectScopeKey, projectsService, workspaceId])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void loadProjects()
    })
    return () => {
      cancelled = true
      projectEpochRef.current += 1
    }
  }, [loadProjects])

  const actionableTasks = useMemo(
    () => sortMyTasks(taskState.tasks.filter(isMyTaskActionable)).slice(0, 6),
    [taskState.tasks],
  )
  const recentProjects = useMemo(
    () =>
      [...projects]
        .sort(
          (left, right) =>
            right.updated_at.localeCompare(left.updated_at) ||
            left.project_id.localeCompare(right.project_id),
        )
        .slice(0, 4),
    [projects],
  )
  const effectiveProjectStatus =
    projectLoadedScope === projectScopeKey ? projectStatus : 'loading'

  if (!currentWorkspace) return null

  return (
    <div className="page-stack workbench-page">
      <section className="intro workbench-heading">
        <div>
          <p className="eyebrow">{currentWorkspace.workspace_name}</p>
          <h2>工作台</h2>
          <p>聚合当前需要关注的任务和项目。</p>
        </div>
      </section>

      <section
        aria-labelledby="workbench-tasks-heading"
        className="workbench-section"
      >
        <div className="workbench-section-heading">
          <div>
            <h2 id="workbench-tasks-heading">待我处理</h2>
            <p>优先显示阻塞、待验收和近期需要推进的事项。</p>
          </div>
          <Link className="text-link" to="/tasks">
            查看全部任务
          </Link>
        </div>
        {taskState.status === 'loading' && (
          <LoadingState title="正在加载待处理任务" />
        )}
        {taskState.status === 'error' && (
          <ErrorState
            action={
              <Button onClick={taskState.retry} variant="secondary">
                重试任务
              </Button>
            }
            description={
              taskState.error ?? '待处理任务暂时无法读取，请稍后重试。'
            }
            title="暂时无法加载任务"
          />
        )}
        {taskState.status === 'ready' && actionableTasks.length === 0 && (
          <EmptyState
            action={
              <Link className="text-link" to="/tasks">
                查看我的全部任务
              </Link>
            }
            description="当前没有需要你立即处理的任务。"
            title="暂无待处理事项"
          />
        )}
        {taskState.status === 'ready' && actionableTasks.length > 0 && (
          <div className="my-task-card-list">
            {actionableTasks.map((task) => (
              <MyTaskCard key={task.task_id} task={task} />
            ))}
          </div>
        )}
      </section>

      <section
        aria-labelledby="workbench-projects-heading"
        className="workbench-section"
      >
        <div className="workbench-section-heading">
          <div>
            <h2 id="workbench-projects-heading">我的项目</h2>
            <p>按最后更新时间显示当前可访问的项目。</p>
          </div>
          <Link className="text-link" to="/projects">
            查看全部项目
          </Link>
        </div>
        {effectiveProjectStatus === 'loading' && (
          <LoadingState title="正在加载项目" />
        )}
        {effectiveProjectStatus === 'error' && (
          <ErrorState
            action={
              <Button onClick={() => void loadProjects()} variant="secondary">
                重试项目
              </Button>
            }
            description={projectError ?? '项目列表暂时无法读取，请稍后重试。'}
            title="暂时无法加载项目"
          />
        )}
        {effectiveProjectStatus === 'ready' && recentProjects.length === 0 && (
          <EmptyState
            action={
              <Link className="text-link" to="/projects">
                打开项目列表
              </Link>
            }
            description="当前工作空间还没有你可以访问的项目。"
            title="暂无项目"
          />
        )}
        {effectiveProjectStatus === 'ready' && recentProjects.length > 0 && (
          <div className="workbench-project-grid">
            {recentProjects.map((project) => (
              <article
                className="workbench-project-card"
                key={project.project_id}
              >
                <div className="project-card-heading">
                  <h3>
                    <Link to={`/projects/${project.project_id}`}>
                      {project.name}
                    </Link>
                  </h3>
                  <ProjectStatusBadge status={project.status} />
                </div>
                <dl className="project-card-meta">
                  <div>
                    <dt>项目负责人</dt>
                    <dd>{project.owner_display_name}</dd>
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
                      <DateDisplay
                        kind="date-time"
                        value={project.updated_at}
                      />
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
