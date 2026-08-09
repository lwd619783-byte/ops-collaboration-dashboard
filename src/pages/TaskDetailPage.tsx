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
import { Badge } from '@/components/ui/Badge'
import { DateDisplay } from '@/components/ui/DateDisplay'
import { useAuth } from '@/features/auth'
import { useProjects, type Project } from '@/features/projects'
import { useTasks, type Task } from '@/features/tasks'
import {
  canManageProjectTasks,
  taskPriorityLabels,
  taskStatusLabels,
  taskVisibilityLabels,
  taskWorkloadLabels,
} from '@/features/tasks/taskMeta'
import { useWorkspace } from '@/features/workspaces'

export function TaskDetailPage() {
  const { projectId = '', taskId = '' } = useParams()
  const auth = useAuth()
  const projects = useProjects()
  const tasks = useTasks()
  const workspace = useWorkspace()
  const currentWorkspace = workspace.currentWorkspace
  const appUserId = auth.appUser?.id ?? null
  const [project, setProject] = useState<Project | null>(null)
  const [task, setTask] = useState<Task | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null)
  const requestEpochRef = useRef(0)
  const mountedRef = useRef(true)
  const scopeKey =
    currentWorkspace && appUserId
      ? `${appUserId}:${currentWorkspace.workspace_id}:${currentWorkspace.role}:${projectId}:${taskId}`
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
    const [projectResult, taskResult] = await Promise.all([
      projects.get(projectId),
      tasks.get(taskId),
    ])
    if (!mountedRef.current || requestEpochRef.current !== epoch) return
    if (scopeKeyRef.current !== requestScopeKey) return
    if (
      !projectResult.ok ||
      !taskResult.ok ||
      projectResult.data.project_id !== projectId ||
      projectResult.data.workspace_id !== currentWorkspace.workspace_id ||
      taskResult.data.task_id !== taskId ||
      taskResult.data.project_id !== projectId ||
      taskResult.data.workspace_id !== currentWorkspace.workspace_id
    ) {
      setProject(null)
      setTask(null)
      setLoadedScopeKey(requestScopeKey)
      setLoadState('error')
      return
    }
    setProject(projectResult.data)
    setTask(taskResult.data)
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

  if (!currentWorkspace || !auth.appUser) return null
  if (loadState === 'loading' || loadedScopeKey !== scopeKey) {
    return <LoadingState title="正在加载任务详情" />
  }
  if (loadState === 'error' || !project || !task) {
    return (
      <ErrorState
        action={
          <Link className="text-link" to={`/projects/${projectId}`}>
            返回项目详情
          </Link>
        }
        description="任务不存在或你无权访问。指定人员可见任务不会向其他成员泄露。"
        title="无法打开任务"
      />
    )
  }

  const canManage = canManageProjectTasks(
    project,
    currentWorkspace.role,
    auth.appUser.id,
  )
  const peopleText = (people: Task['collaborators']) =>
    people.length === 0
      ? '未指定'
      : people.map((person) => person.display_name).join('、')

  return (
    <div className="page-stack task-detail-page">
      <section className="intro task-detail-heading">
        <div>
          <p className="eyebrow">
            {project.name} · {task.module_name}
          </p>
          <h2>{task.title}</h2>
          <div className="task-badge-row">
            <Badge className="badge-info">
              {taskStatusLabels[task.status]}
            </Badge>
            <Badge className="badge-neutral">
              {taskVisibilityLabels[task.visibility]}
            </Badge>
          </div>
        </div>
        <div className="project-detail-actions">
          <Link
            className="button button-secondary button-md"
            to={`/projects/${project.project_id}`}
          >
            返回项目
          </Link>
          {canManage && (
            <Link
              className="button button-primary button-md"
              to={`/projects/${project.project_id}/tasks/${task.task_id}/edit`}
            >
              编辑任务
            </Link>
          )}
        </div>
      </section>

      <section className="task-detail-card">
        <h3>任务职责与计划</h3>
        <dl className="task-detail-grid">
          <div>
            <dt>项目模块</dt>
            <dd>{task.module_name}</dd>
          </div>
          <div>
            <dt>主要负责人</dt>
            <dd>{task.assignee_display_name}</dd>
          </div>
          <div>
            <dt>协作人</dt>
            <dd>{peopleText(task.collaborators)}</dd>
          </div>
          <div>
            <dt>验收人</dt>
            <dd>{task.reviewer_display_name}</dd>
          </div>
          <div>
            <dt>优先级</dt>
            <dd>{taskPriorityLabels[task.priority]}</dd>
          </div>
          <div>
            <dt>工作量</dt>
            <dd>{taskWorkloadLabels[task.workload_level]}</dd>
          </div>
          <div>
            <dt>开始日期</dt>
            <dd>
              <DateDisplay value={task.start_date} />
            </dd>
          </div>
          <div>
            <dt>截止日期</dt>
            <dd>
              <DateDisplay value={task.due_date} />
            </dd>
          </div>
          <div>
            <dt>预计工时</dt>
            <dd>
              {task.estimated_hours === null
                ? '未设置'
                : `${task.estimated_hours} 小时`}
            </dd>
          </div>
          <div>
            <dt>完成比例</dt>
            <dd>{task.progress}%</dd>
          </div>
          <div>
            <dt>更新于</dt>
            <dd>
              <DateDisplay kind="date-time" value={task.updated_at} />
            </dd>
          </div>
        </dl>
      </section>

      <section className="task-detail-copy-grid">
        <article className="task-detail-card">
          <h3>任务说明</h3>
          <p>{task.description ?? '未填写任务说明。'}</p>
        </article>
        <article className="task-detail-card">
          <h3>验收标准</h3>
          <p>{task.acceptance_criteria ?? '未填写验收标准。'}</p>
        </article>
      </section>

      {task.visibility === 'restricted' && (
        <section className="task-detail-card">
          <h3>显式可见人员</h3>
          <p>{peopleText(task.visibility_users)}</p>
        </section>
      )}
    </div>
  )
}
