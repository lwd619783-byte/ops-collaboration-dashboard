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
import { TextareaField } from '@/components/forms/TextareaField'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DateDisplay } from '@/components/ui/DateDisplay'
import { Dialog } from '@/components/ui/Dialog'
import { useAuth } from '@/features/auth'
import { useProjects, type Project } from '@/features/projects'
import {
  useTasks,
  type Task,
  type TaskStatusAction,
  type TaskStatusHistoryItem,
} from '@/features/tasks'
import {
  canManageProjectTasks,
  taskPriorityLabels,
  taskStatusActionLabels,
  taskStatusLabels,
  taskVisibilityLabels,
  taskWorkloadLabels,
} from '@/features/tasks/taskMeta'
import { useWorkspace } from '@/features/workspaces'

const BLOCKER_REASON_LIMIT = 2000

type StatusIntent = {
  action: TaskStatusAction
  idempotencyKey: string
  blockerReason: string | null
}

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
  const [history, setHistory] = useState<TaskStatusHistoryItem[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<TaskStatusAction | null>(
    null,
  )
  const [actionError, setActionError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'block' | 'cancel' | null>(null)
  const [blockerReason, setBlockerReason] = useState('')
  const [blockerReasonError, setBlockerReasonError] = useState<string | null>(
    null,
  )
  const requestEpochRef = useRef(0)
  const actionEpochRef = useRef(0)
  const intentRef = useRef<StatusIntent | null>(null)
  const mountedRef = useRef(true)
  const scopeKey =
    currentWorkspace && appUserId
      ? `${appUserId}:${currentWorkspace.workspace_id}:${currentWorkspace.role}:${projectId}:${taskId}`
      : null
  const scopeKeyRef = useRef(scopeKey)

  useLayoutEffect(() => {
    scopeKeyRef.current = scopeKey
    actionEpochRef.current += 1
    intentRef.current = null
  }, [scopeKey])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestEpochRef.current += 1
      actionEpochRef.current += 1
    }
  }, [])

  const load = useCallback(async () => {
    if (!appUserId || !currentWorkspace || !scopeKey) return
    const epoch = ++requestEpochRef.current
    const requestScopeKey = scopeKey
    setLoadState('loading')
    setLoadedScopeKey(null)
    setActionError(null)
    setActionLoading(null)
    setDialog(null)
    intentRef.current = null
    const [projectResult, taskResult, historyResult] = await Promise.all([
      projects.get(projectId),
      tasks.get(taskId),
      tasks.listStatusHistory(taskId),
    ])
    if (!mountedRef.current || requestEpochRef.current !== epoch) return
    if (scopeKeyRef.current !== requestScopeKey) return
    if (
      !projectResult.ok ||
      !taskResult.ok ||
      !historyResult.ok ||
      projectResult.data.project_id !== projectId ||
      projectResult.data.workspace_id !== currentWorkspace.workspace_id ||
      taskResult.data.task_id !== taskId ||
      taskResult.data.project_id !== projectId ||
      taskResult.data.workspace_id !== currentWorkspace.workspace_id ||
      historyResult.data.some((item) => item.task_id !== taskId)
    ) {
      setProject(null)
      setTask(null)
      setHistory([])
      setLoadedScopeKey(requestScopeKey)
      setLoadState('error')
      return
    }
    setProject(projectResult.data)
    setTask(taskResult.data)
    setHistory(historyResult.data)
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

  const runAction = useCallback(
    async (action: TaskStatusAction, reason: string | null = null) => {
      if (!project || !task || !scopeKey || !currentWorkspace) return false
      const normalizedReason = reason?.trim() || null
      const existingIntent = intentRef.current
      const idempotencyKey =
        existingIntent?.action === action &&
        existingIntent.blockerReason === normalizedReason
          ? existingIntent.idempotencyKey
          : crypto.randomUUID()
      intentRef.current = {
        action,
        idempotencyKey,
        blockerReason: normalizedReason,
      }
      const epoch = ++actionEpochRef.current
      const requestScopeKey = scopeKey
      setActionLoading(action)
      setActionError(null)
      const input = {
        taskId: task.task_id,
        projectId: project.project_id,
        workspaceId: currentWorkspace.workspace_id,
        idempotencyKey,
      }
      const result =
        action === 'start'
          ? await tasks.start(input)
          : action === 'block'
            ? await tasks.block({
                ...input,
                blockerReason: normalizedReason ?? '',
              })
            : action === 'resume'
              ? await tasks.resume(input)
              : await tasks.cancel(input)
      if (
        !mountedRef.current ||
        actionEpochRef.current !== epoch ||
        scopeKeyRef.current !== requestScopeKey
      ) {
        return false
      }
      if (!result.ok) {
        if (
          result.error.code !== 'network_unavailable' &&
          result.error.code !== 'unknown_service_error'
        ) {
          intentRef.current = null
        }
        setActionError(result.error.message)
        setActionLoading(null)
        return false
      }

      const historyResult = await tasks.listStatusHistory(task.task_id)
      if (
        !mountedRef.current ||
        actionEpochRef.current !== epoch ||
        scopeKeyRef.current !== requestScopeKey
      ) {
        return false
      }
      if (!historyResult.ok) {
        if (
          historyResult.error.code !== 'network_unavailable' &&
          historyResult.error.code !== 'unknown_service_error'
        ) {
          intentRef.current = null
        }
        setActionError(historyResult.error.message)
        setActionLoading(null)
        return false
      }
      if (
        result.data.task.task_id !== task.task_id ||
        result.data.task.project_id !== project.project_id ||
        result.data.task.workspace_id !== currentWorkspace.workspace_id ||
        historyResult.data.some((item) => item.task_id !== task.task_id)
      ) {
        intentRef.current = null
        setActionError('任务操作暂时无法完成，请刷新后重试。')
        setActionLoading(null)
        return false
      }
      setTask(result.data.task)
      setHistory(historyResult.data)
      setActionLoading(null)
      setActionError(null)
      intentRef.current = null
      return true
    },
    [currentWorkspace, project, scopeKey, task, tasks],
  )

  const closeDialog = () => {
    if (actionLoading) return
    setDialog(null)
    setActionError(null)
    setBlockerReasonError(null)
    setBlockerReason('')
    intentRef.current = null
  }

  const submitBlock = async () => {
    const normalized = blockerReason.trim()
    if (!normalized) {
      setBlockerReasonError('请填写阻塞原因。')
      return
    }
    if (normalized.length > BLOCKER_REASON_LIMIT) {
      setBlockerReasonError(`阻塞原因不能超过 ${BLOCKER_REASON_LIMIT} 个字符。`)
      return
    }
    setBlockerReasonError(null)
    if (await runAction('block', normalized)) {
      setDialog(null)
      setBlockerReason('')
    }
  }

  const submitCancel = async () => {
    if (await runAction('cancel')) setDialog(null)
  }

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
  const canExecute =
    project.status !== 'archived' &&
    (canManage || task.assignee_id === auth.appUser.id)
  const hasTaskAction =
    project.status !== 'archived' &&
    ['todo', 'in_progress', 'blocked'].includes(task.status) &&
    (canExecute || canManage)
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
            to={`/projects/${project.project_id}/tasks`}
          >
            返回任务中心
          </Link>
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

      <section className="task-detail-card task-status-actions">
        <h3>状态操作</h3>
        <p>当前状态：{taskStatusLabels[task.status]}</p>
        {hasTaskAction ? (
          <div className="task-status-action-buttons">
            {task.status === 'todo' && canExecute && (
              <Button
                loading={actionLoading === 'start'}
                onClick={() => void runAction('start')}
              >
                开始任务
              </Button>
            )}
            {task.status === 'in_progress' && canExecute && (
              <Button
                loading={actionLoading === 'block'}
                onClick={() => {
                  setActionError(null)
                  setBlockerReasonError(null)
                  setDialog('block')
                }}
              >
                标记阻塞
              </Button>
            )}
            {task.status === 'blocked' && canExecute && (
              <Button
                loading={actionLoading === 'resume'}
                onClick={() => void runAction('resume')}
              >
                恢复进行中
              </Button>
            )}
            {canManage && (
              <Button
                onClick={() => {
                  setActionError(null)
                  setDialog('cancel')
                }}
                variant="danger"
              >
                取消任务
              </Button>
            )}
          </div>
        ) : (
          <p className="muted">当前没有可执行的 Task 3.3 状态操作。</p>
        )}
        {actionError && !dialog && <p role="alert">{actionError}</p>}
      </section>

      {task.status === 'blocked' && (
        <section className="task-detail-card task-current-blocker">
          <h3>当前阻塞</h3>
          <p className="task-current-blocker-label">已阻塞</p>
          <p>{task.blocker_reason}</p>
          <dl className="task-detail-grid">
            <div>
              <dt>阻塞人</dt>
              <dd>{task.blocked_by_display_name}</dd>
            </div>
            <div>
              <dt>阻塞于</dt>
              <dd>
                <DateDisplay kind="date-time" value={task.blocked_at} />
              </dd>
            </div>
          </dl>
        </section>
      )}

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

      <section className="task-detail-card task-status-history">
        <h3>状态历史</h3>
        {history.length === 0 ? (
          <p className="muted">尚无状态变更记录。</p>
        ) : (
          <ol className="task-status-history-list">
            {history.map((item) => (
              <li key={item.transition_id}>
                <div className="task-status-history-heading">
                  <strong>
                    {item.actor_display_name} ·{' '}
                    {taskStatusActionLabels[item.action]}
                  </strong>
                  <span>#{item.sequence}</span>
                </div>
                <p>
                  {taskStatusLabels[item.from_status]} →{' '}
                  {taskStatusLabels[item.to_status]}
                </p>
                {item.reason && <p>阻塞原因：{item.reason}</p>}
                <DateDisplay kind="date-time" value={item.created_at} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <Dialog
        confirmDisabled={
          !blockerReason.trim() ||
          blockerReason.trim().length > BLOCKER_REASON_LIMIT
        }
        confirmLabel="确认标记阻塞"
        confirmLoading={actionLoading === 'block'}
        description="请填写当前任务无法继续推进的原因。"
        onClose={closeDialog}
        onConfirm={() => void submitBlock()}
        open={dialog === 'block'}
        title="标记任务阻塞"
      >
        <TextareaField
          description={`${blockerReason.length}/${BLOCKER_REASON_LIMIT}`}
          error={blockerReasonError ?? undefined}
          label="阻塞原因"
          maxLength={BLOCKER_REASON_LIMIT}
          onChange={(event) => {
            setBlockerReason(event.target.value)
            setBlockerReasonError(null)
            setActionError(null)
          }}
          required
          rows={5}
          value={blockerReason}
        />
        {actionError && <p role="alert">{actionError}</p>}
      </Dialog>

      <Dialog
        confirmLabel="确认取消任务"
        confirmLoading={actionLoading === 'cancel'}
        danger
        description="取消后 Task 3.3 不提供恢复入口，任务及其历史记录仍会保留。"
        onClose={closeDialog}
        onConfirm={() => void submitCancel()}
        open={dialog === 'cancel'}
        title="确认取消任务？"
      >
        {actionError && <p role="alert">{actionError}</p>}
      </Dialog>
    </div>
  )
}
