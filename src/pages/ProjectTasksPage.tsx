import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DateDisplay } from '@/components/ui/DateDisplay'
import { useAuth } from '@/features/auth'
import {
  useProjects,
  type Project,
  type ProjectModule,
} from '@/features/projects'
import { useTasks, type TaskPerson, type TaskSummary } from '@/features/tasks'
import {
  filterTaskSummaries,
  getLocalDateOnly,
  hasActiveTaskFilters,
  isTaskOverdue,
  parseTaskListState,
  sortTaskSummaries,
  taskStatusOrder,
  type TaskListFilters,
  type TaskListView,
} from '@/features/tasks/taskList'
import {
  canManageProjectTasks,
  taskPriorityLabels,
  taskStatusLabels,
  taskVisibilityLabels,
} from '@/features/tasks/taskMeta'
import type { TaskPriority } from '@/features/tasks/types'
import { useWorkspace } from '@/features/workspaces'

type TaskCenterResources = {
  project: Project
  modules: ProjectModule[]
  tasks: TaskSummary[]
}

type NamedOption = { id: string; name: string }

const priorityOrder: readonly TaskPriority[] = [
  'urgent',
  'high',
  'medium',
  'low',
]

function namedOptions(people: readonly TaskPerson[]): NamedOption[] {
  const names = new Map<string, string>()
  for (const person of people)
    names.set(person.app_user_id, person.display_name)
  return [...names.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, 'zh-CN') ||
        left.id.localeCompare(right.id),
    )
}

function OverdueText({ overdue }: { overdue: boolean }) {
  return (
    <span className={overdue ? 'task-overdue' : 'task-not-overdue'}>
      {overdue ? '已逾期' : '未逾期'}
    </span>
  )
}

function TaskCard({
  projectId,
  task,
  today,
}: {
  projectId: string
  task: TaskSummary
  today: string
}) {
  const overdue = isTaskOverdue(task, today)
  return (
    <article className="task-summary-card">
      <Link
        className="task-summary-card-link"
        to={`/projects/${projectId}/tasks/${task.task_id}`}
      >
        <span className="task-summary-title">{task.title}</span>
        <span className="task-summary-module">{task.module_name}</span>
        <span className="task-summary-meta">
          负责人：{task.assignee_display_name}
        </span>
        <span className="task-summary-meta">
          状态：{taskStatusLabels[task.status]}
        </span>
        <span className="task-summary-meta">
          优先级：{taskPriorityLabels[task.priority]}
        </span>
        <span className="task-summary-meta">
          截止：
          <DateDisplay value={task.due_date} />
        </span>
        <span className="task-summary-meta">进度：{task.progress}%</span>
        <span className="task-summary-badges">
          <Badge className="badge-neutral">
            {taskVisibilityLabels[task.visibility]}
          </Badge>
          <OverdueText overdue={overdue} />
        </span>
      </Link>
    </article>
  )
}

function TaskBoard({
  projectId,
  tasks,
  today,
}: {
  projectId: string
  tasks: readonly TaskSummary[]
  today: string
}) {
  return (
    <div className="task-board" aria-label="任务状态看板">
      {taskStatusOrder.map((status) => {
        const statusTasks = tasks.filter((task) => task.status === status)
        return (
          <section className="task-board-column" key={status}>
            <div className="task-board-column-heading">
              <h3>{taskStatusLabels[status]}</h3>
              <span
                aria-label={`${taskStatusLabels[status]} ${statusTasks.length} 项`}
              >
                {statusTasks.length}
              </span>
            </div>
            {statusTasks.length === 0 ? (
              <p className="task-board-empty">当前列暂无任务</p>
            ) : (
              <div className="task-board-cards">
                {statusTasks.map((task) => (
                  <TaskCard
                    key={task.task_id}
                    projectId={projectId}
                    task={task}
                    today={today}
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function TaskTable({
  projectId,
  tasks,
  today,
}: {
  projectId: string
  tasks: readonly TaskSummary[]
  today: string
}) {
  return (
    <>
      <div className="task-list-table table-wrap">
        <table>
          <caption>项目任务列表，共 {tasks.length} 项</caption>
          <thead>
            <tr>
              <th scope="col">任务</th>
              <th scope="col">模块</th>
              <th scope="col">负责人</th>
              <th scope="col">状态</th>
              <th scope="col">优先级</th>
              <th scope="col">截止日期</th>
              <th scope="col">进度</th>
              <th scope="col">逾期</th>
              <th scope="col">更新时间</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.task_id}>
                <th scope="row">
                  <Link
                    className="text-link"
                    to={`/projects/${projectId}/tasks/${task.task_id}`}
                  >
                    {task.title}
                  </Link>
                </th>
                <td>{task.module_name}</td>
                <td>{task.assignee_display_name}</td>
                <td>{taskStatusLabels[task.status]}</td>
                <td>{taskPriorityLabels[task.priority]}</td>
                <td>
                  <DateDisplay value={task.due_date} />
                </td>
                <td>
                  <progress
                    aria-label={`${task.title} 进度`}
                    max="100"
                    value={task.progress}
                  />{' '}
                  {task.progress}%
                </td>
                <td>
                  <OverdueText overdue={isTaskOverdue(task, today)} />
                </td>
                <td>
                  <DateDisplay kind="date-time" value={task.updated_at} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="task-list-mobile" aria-label="项目任务列表">
        {tasks.map((task) => (
          <TaskCard
            key={task.task_id}
            projectId={projectId}
            task={task}
            today={today}
          />
        ))}
      </div>
    </>
  )
}

function TaskFilters({
  assignees,
  collaborators,
  filters,
  modules,
  onChange,
  onClear,
}: {
  assignees: NamedOption[]
  collaborators: NamedOption[]
  filters: TaskListFilters
  modules: ProjectModule[]
  onChange: (key: keyof TaskListFilters, value: string | boolean | null) => void
  onClear: () => void
}) {
  return (
    <section className="task-filters" aria-label="任务筛选">
      <div className="task-filter-grid">
        <label>
          <span>模块</span>
          <select
            onChange={(event) =>
              onChange('moduleId', event.target.value || null)
            }
            value={filters.moduleId ?? ''}
          >
            <option value="">全部模块</option>
            {modules.map((module) => (
              <option key={module.module_id} value={module.module_id}>
                {module.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>负责人</span>
          <select
            onChange={(event) =>
              onChange('assigneeId', event.target.value || null)
            }
            value={filters.assigneeId ?? ''}
          >
            <option value="">全部负责人</option>
            {assignees.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>协作人</span>
          <select
            onChange={(event) =>
              onChange('collaboratorId', event.target.value || null)
            }
            value={filters.collaboratorId ?? ''}
          >
            <option value="">全部协作人</option>
            {collaborators.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>状态</span>
          <select
            onChange={(event) => onChange('status', event.target.value || null)}
            value={filters.status ?? ''}
          >
            <option value="">全部状态</option>
            {taskStatusOrder.map((status) => (
              <option key={status} value={status}>
                {taskStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>优先级</span>
          <select
            onChange={(event) =>
              onChange('priority', event.target.value || null)
            }
            value={filters.priority ?? ''}
          >
            <option value="">全部优先级</option>
            {priorityOrder.map((priority) => (
              <option key={priority} value={priority}>
                {taskPriorityLabels[priority]}
              </option>
            ))}
          </select>
        </label>
        <label className="task-overdue-filter">
          <input
            checked={filters.overdue}
            onChange={(event) => onChange('overdue', event.target.checked)}
            type="checkbox"
          />
          <span>仅看已逾期</span>
        </label>
      </div>
      <Button
        disabled={!hasActiveTaskFilters(filters)}
        onClick={onClear}
        size="sm"
        variant="secondary"
      >
        清空筛选
      </Button>
    </section>
  )
}

const queryKeys: Record<keyof TaskListFilters, string> = {
  moduleId: 'module',
  assigneeId: 'assignee',
  collaboratorId: 'collaborator',
  status: 'status',
  priority: 'priority',
  overdue: 'overdue',
}

export function ProjectTasksPage() {
  const { projectId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const auth = useAuth()
  const projects = useProjects()
  const tasksService = useTasks()
  const workspace = useWorkspace()
  const currentWorkspace = workspace.currentWorkspace
  const appUserId = auth.appUser?.id ?? null
  const [resources, setResources] = useState<TaskCenterResources | null>(null)
  const [loadState, setLoadState] = useState<
    'loading' | 'ready' | 'project_error' | 'service_error'
  >('loading')
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const requestEpochRef = useRef(0)
  const scopeKey =
    currentWorkspace && appUserId
      ? `${appUserId}:${currentWorkspace.workspace_id}:${currentWorkspace.role}:${projectId}`
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
    if (!currentWorkspace || !appUserId || !scopeKey) return
    const epoch = ++requestEpochRef.current
    const requestScopeKey = scopeKey
    const requestWorkspaceId = currentWorkspace.workspace_id
    setResources(null)
    setLoadState('loading')
    setLoadedScopeKey(null)
    const [projectResult, moduleResult, taskResult] = await Promise.all([
      projects.get(projectId),
      projects.listModules(projectId),
      tasksService.list({
        projectId,
        workspaceId: requestWorkspaceId,
      }),
    ])
    if (!mountedRef.current || requestEpochRef.current !== epoch) return
    if (scopeKeyRef.current !== requestScopeKey) return
    if (!projectResult.ok) {
      setLoadedScopeKey(requestScopeKey)
      setLoadState(
        projectResult.error.code === 'not_found_or_forbidden' ||
          projectResult.error.code === 'permission_denied'
          ? 'project_error'
          : 'service_error',
      )
      return
    }
    if (!moduleResult.ok || !taskResult.ok) {
      setLoadedScopeKey(requestScopeKey)
      setLoadState('service_error')
      return
    }
    if (
      projectResult.data.project_id !== projectId ||
      projectResult.data.workspace_id !== requestWorkspaceId ||
      moduleResult.data.some((module) => module.project_id !== projectId) ||
      taskResult.data.some(
        (task) =>
          task.project_id !== projectId ||
          task.workspace_id !== requestWorkspaceId,
      )
    ) {
      setLoadedScopeKey(requestScopeKey)
      setLoadState('service_error')
      return
    }
    setResources({
      project: projectResult.data,
      modules: moduleResult.data,
      tasks: taskResult.data,
    })
    setLoadedScopeKey(requestScopeKey)
    setLoadState('ready')
  }, [appUserId, currentWorkspace, projectId, projects, scopeKey, tasksService])

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

  const taskRows = useMemo(() => resources?.tasks ?? [], [resources?.tasks])
  const moduleRows = useMemo(
    () => resources?.modules ?? [],
    [resources?.modules],
  )
  const assignees = useMemo(
    () =>
      namedOptions(
        taskRows.map((task) => ({
          app_user_id: task.assignee_id,
          display_name: task.assignee_display_name,
        })),
      ),
    [taskRows],
  )
  const collaborators = useMemo(
    () => namedOptions(taskRows.flatMap((task) => task.collaborators)),
    [taskRows],
  )
  const listState = useMemo(
    () =>
      parseTaskListState(searchParams, {
        moduleIds: new Set(moduleRows.map((module) => module.module_id)),
        assigneeIds: new Set(assignees.map((person) => person.id)),
        collaboratorIds: new Set(collaborators.map((person) => person.id)),
      }),
    [assignees, collaborators, moduleRows, searchParams],
  )
  const today = getLocalDateOnly()
  const visibleTasks = sortTaskSummaries(
    filterTaskSummaries(taskRows, listState.filters, today),
    today,
  )

  const updateView = (view: TaskListView) => {
    const next = new URLSearchParams(searchParams)
    next.set('view', view)
    setSearchParams(next)
  }
  const updateFilter = (
    key: keyof TaskListFilters,
    value: string | boolean | null,
  ) => {
    const next = new URLSearchParams(searchParams)
    const queryKey = queryKeys[key]
    if (key === 'overdue') {
      if (value === true) next.set(queryKey, 'overdue')
      else next.delete(queryKey)
    } else if (typeof value === 'string' && value.length > 0) {
      next.set(queryKey, value)
    } else {
      next.delete(queryKey)
    }
    setSearchParams(next)
  }
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams)
    for (const key of Object.values(queryKeys)) next.delete(key)
    setSearchParams(next)
  }

  if (!currentWorkspace || !auth.appUser) return null
  if (loadState === 'loading' || loadedScopeKey !== scopeKey) {
    return <LoadingState title="正在加载项目任务" />
  }
  if (loadState === 'project_error') {
    return (
      <ErrorState
        action={
          <Link className="text-link" to="/projects">
            返回项目列表
          </Link>
        }
        description="项目不存在或你无权访问。"
        title="无法打开项目任务"
      />
    )
  }
  if (loadState === 'service_error' || !resources) {
    return (
      <ErrorState
        action={
          <Button onClick={() => void load()} variant="secondary">
            重新加载
          </Button>
        }
        description="任务列表服务暂时不可用，请稍后重试。"
        title="无法加载任务列表"
      />
    )
  }

  const canManage = canManageProjectTasks(
    resources.project,
    currentWorkspace.role,
    auth.appUser.id,
  )

  return (
    <div className="page-stack task-center-page">
      <section className="intro task-center-heading">
        <div>
          <p className="eyebrow">{resources.project.name}</p>
          <h2>项目任务</h2>
          <p>仅展示你当前有权读取的任务；看板和列表均为只读浏览。</p>
        </div>
        <div className="project-detail-actions">
          <Link
            className="button button-secondary button-md"
            to={`/projects/${resources.project.project_id}`}
          >
            返回项目
          </Link>
          {canManage && (
            <Link
              className="button button-primary button-md"
              to={`/projects/${resources.project.project_id}/tasks/new`}
            >
              创建任务
            </Link>
          )}
        </div>
      </section>

      {resources.tasks.length > 0 && (
        <>
          <section className="task-center-toolbar" aria-label="任务浏览视图">
            <div className="task-view-toggle">
              <Button
                aria-pressed={listState.view === 'board'}
                onClick={() => updateView('board')}
                size="sm"
                variant={listState.view === 'board' ? 'primary' : 'secondary'}
              >
                看板视图
              </Button>
              <Button
                aria-pressed={listState.view === 'list'}
                onClick={() => updateView('list')}
                size="sm"
                variant={listState.view === 'list' ? 'primary' : 'secondary'}
              >
                列表视图
              </Button>
            </div>
            <p role="status">当前显示 {visibleTasks.length} 项任务</p>
          </section>
          <TaskFilters
            assignees={assignees}
            collaborators={collaborators}
            filters={listState.filters}
            modules={resources.modules}
            onChange={updateFilter}
            onClear={clearFilters}
          />
        </>
      )}

      {resources.tasks.length === 0 ? (
        <EmptyState
          action={
            canManage ? (
              <Link
                className="button button-primary button-md"
                to={`/projects/${resources.project.project_id}/tasks/new`}
              >
                创建第一个任务
              </Link>
            ) : undefined
          }
          description="此项目当前没有你可以查看的任务。"
          title="当前暂无任务"
        />
      ) : visibleTasks.length === 0 ? (
        <EmptyState
          action={
            <Button onClick={clearFilters} variant="secondary">
              清空筛选
            </Button>
          }
          description="项目存在可见任务，但没有任务符合当前组合筛选。"
          title="没有符合当前筛选条件的任务"
        />
      ) : listState.view === 'board' ? (
        <TaskBoard
          projectId={resources.project.project_id}
          tasks={visibleTasks}
          today={today}
        />
      ) : (
        <TaskTable
          projectId={resources.project.project_id}
          tasks={visibleTasks}
          today={today}
        />
      )}
    </div>
  )
}
