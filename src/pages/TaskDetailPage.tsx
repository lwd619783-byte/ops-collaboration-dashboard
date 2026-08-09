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
import { InputField } from '@/components/forms/InputField'
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
  type TaskProgressFormValues,
  type TaskProgressUpdate,
  loadConsistentTaskState,
  refreshConsistentTaskState,
  TASK_STATE_CONFLICT_MESSAGE,
} from '@/features/tasks'
import {
  currentLocalCalendarDate,
  TASK_PROGRESS_LIMITS,
  validateTaskProgressForm,
  type TaskProgressFormErrors,
} from '@/features/tasks/validation'
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

type ProgressIntent = {
  fingerprint: string
  idempotencyKey: string
}

function initialProgressForm(progress: number): TaskProgressFormValues {
  return {
    recordDate: currentLocalCalendarDate(),
    completedContent: '',
    progress: String(progress),
    issues: '',
    nextSteps: '',
    needsAssistance: false,
    markBlocked: false,
    blockerReason: '',
  }
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
  const [updates, setUpdates] = useState<TaskProgressUpdate[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<TaskStatusAction | null>(
    null,
  )
  const [progressLoading, setProgressLoading] = useState(false)
  const actionBusy = actionLoading !== null || progressLoading
  const [actionError, setActionError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'block' | 'cancel' | null>(null)
  const [blockerReason, setBlockerReason] = useState('')
  const [blockerReasonError, setBlockerReasonError] = useState<string | null>(
    null,
  )
  const [progressForm, setProgressForm] = useState<TaskProgressFormValues>(() =>
    initialProgressForm(0),
  )
  const [progressErrors, setProgressErrors] = useState<TaskProgressFormErrors>(
    {},
  )
  const [progressError, setProgressError] = useState<string | null>(null)
  const [progressConfirmOpen, setProgressConfirmOpen] = useState(false)
  const requestEpochRef = useRef(0)
  const actionEpochRef = useRef(0)
  const intentRef = useRef<StatusIntent | null>(null)
  const progressIntentRef = useRef<ProgressIntent | null>(null)
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
    progressIntentRef.current = null
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
    setProgressLoading(false)
    setProgressError(null)
    setProgressErrors({})
    setProgressConfirmOpen(false)
    setDialog(null)
    intentRef.current = null
    progressIntentRef.current = null
    const [projectResult, stateResult] = await Promise.all([
      projects.get(projectId),
      loadConsistentTaskState(tasks, taskId),
    ])
    if (!mountedRef.current || requestEpochRef.current !== epoch) return
    if (scopeKeyRef.current !== requestScopeKey) return
    if (
      !projectResult.ok ||
      !stateResult.ok ||
      projectResult.data.project_id !== projectId ||
      projectResult.data.workspace_id !== currentWorkspace.workspace_id ||
      stateResult.data.task.task_id !== taskId ||
      stateResult.data.task.project_id !== projectId ||
      stateResult.data.task.workspace_id !== currentWorkspace.workspace_id ||
      stateResult.data.history.some((item) => item.task_id !== taskId)
    ) {
      setProject(null)
      setTask(null)
      setHistory([])
      setUpdates([])
      setLoadedScopeKey(requestScopeKey)
      setLoadState('error')
      return
    }
    setProject(projectResult.data)
    setTask(stateResult.data.task)
    setHistory(stateResult.data.history)
    setUpdates(stateResult.data.updates)
    setProgressForm(initialProgressForm(stateResult.data.task.progress))
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

      const refreshResult = await refreshConsistentTaskState(
        tasks,
        task.task_id,
        result.data.transition.transition_id,
      )
      if (
        !mountedRef.current ||
        actionEpochRef.current !== epoch ||
        scopeKeyRef.current !== requestScopeKey
      ) {
        return false
      }
      if (!refreshResult.ok) {
        intentRef.current = null
        setActionError(TASK_STATE_CONFLICT_MESSAGE)
        setActionLoading(null)
        return false
      }
      if (
        refreshResult.data.task.task_id !== task.task_id ||
        refreshResult.data.task.project_id !== project.project_id ||
        refreshResult.data.task.workspace_id !==
          currentWorkspace.workspace_id ||
        refreshResult.data.history.some((item) => item.task_id !== task.task_id)
      ) {
        intentRef.current = null
        setActionError(TASK_STATE_CONFLICT_MESSAGE)
        setActionLoading(null)
        return false
      }
      setTask(refreshResult.data.task)
      setHistory(refreshResult.data.history)
      setUpdates(refreshResult.data.updates)
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

  const updateProgressField = <K extends keyof TaskProgressFormValues>(
    field: K,
    value: TaskProgressFormValues[K],
  ) => {
    setProgressForm((current) => ({ ...current, [field]: value }))
    setProgressErrors((current) => ({ ...current, [field]: undefined }))
    setProgressError(null)
    progressIntentRef.current = null
  }

  const runProgressUpdate = useCallback(async () => {
    if (!project || !task || !scopeKey || !currentWorkspace) return false
    const normalized = {
      recordDate: progressForm.recordDate,
      completedContent: progressForm.completedContent.trim(),
      progress: Number(progressForm.progress),
      issues: progressForm.issues.trim(),
      nextSteps: progressForm.nextSteps.trim(),
      needsAssistance: progressForm.needsAssistance,
      markBlocked: progressForm.markBlocked,
      blockerReason: progressForm.markBlocked
        ? progressForm.blockerReason.trim()
        : '',
    }
    const fingerprint = JSON.stringify(normalized)
    const idempotencyKey =
      progressIntentRef.current?.fingerprint === fingerprint
        ? progressIntentRef.current.idempotencyKey
        : crypto.randomUUID()
    progressIntentRef.current = { fingerprint, idempotencyKey }
    const epoch = ++actionEpochRef.current
    const requestScopeKey = scopeKey
    setProgressLoading(true)
    setProgressError(null)
    const result = await tasks.createProgressUpdate({
      taskId: task.task_id,
      projectId: project.project_id,
      workspaceId: currentWorkspace.workspace_id,
      ...normalized,
      idempotencyKey,
    })
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
        progressIntentRef.current = null
      }
      setProgressError(result.error.message)
      setProgressLoading(false)
      return false
    }
    const refreshResult = await refreshConsistentTaskState(
      tasks,
      task.task_id,
      result.data.update.block_transition_id,
      result.data.update.update_id,
    )
    if (
      !mountedRef.current ||
      actionEpochRef.current !== epoch ||
      scopeKeyRef.current !== requestScopeKey
    ) {
      return false
    }
    if (
      !refreshResult.ok ||
      refreshResult.data.task.task_id !== task.task_id ||
      refreshResult.data.task.project_id !== project.project_id ||
      refreshResult.data.task.workspace_id !== currentWorkspace.workspace_id ||
      refreshResult.data.history.some(
        (item) => item.task_id !== task.task_id,
      ) ||
      refreshResult.data.updates.some((item) => item.task_id !== task.task_id)
    ) {
      setProgressError(TASK_STATE_CONFLICT_MESSAGE)
      setProgressLoading(false)
      return false
    }
    setTask(refreshResult.data.task)
    setHistory(refreshResult.data.history)
    setUpdates(refreshResult.data.updates)
    setProgressForm(initialProgressForm(refreshResult.data.task.progress))
    setProgressErrors({})
    setProgressError(null)
    setProgressLoading(false)
    setProgressConfirmOpen(false)
    progressIntentRef.current = null
    return true
  }, [currentWorkspace, progressForm, project, scopeKey, task, tasks])

  const beginProgressSubmit = () => {
    if (!task) return
    if (task.status !== 'in_progress' && task.status !== 'blocked') return
    const errors = validateTaskProgressForm(progressForm, task.status)
    setProgressErrors(errors)
    setProgressError(null)
    if (Object.keys(errors).length > 0) return
    if (progressForm.markBlocked) {
      setProgressConfirmOpen(true)
      return
    }
    void runProgressUpdate()
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
  const canWriteProgress =
    project.status !== 'archived' &&
    task.assignee_id === auth.appUser.id &&
    (task.status === 'in_progress' || task.status === 'blocked')
  const latestFirstUpdates = [...updates].sort(
    (left, right) => right.sequence - left.sequence,
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
                disabled={actionBusy && actionLoading !== 'start'}
                onClick={() => void runAction('start')}
              >
                开始任务
              </Button>
            )}
            {task.status === 'in_progress' && canExecute && (
              <Button
                loading={actionLoading === 'block'}
                disabled={actionBusy && actionLoading !== 'block'}
                onClick={() => {
                  if (actionBusy) return
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
                disabled={actionBusy && actionLoading !== 'resume'}
                onClick={() => void runAction('resume')}
              >
                恢复进行中
              </Button>
            )}
            {canManage && (
              <Button
                disabled={actionBusy}
                onClick={() => {
                  if (actionBusy) return
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

      <section className="task-detail-card task-progress-section">
        <div className="task-progress-heading">
          <div>
            <h3>每日进展</h3>
            <p className="task-current-progress">当前进度 {task.progress}%</p>
          </div>
          <progress
            aria-label={`当前任务进度 ${task.progress}%`}
            max="100"
            value={task.progress}
          >
            {task.progress}%
          </progress>
        </div>
        <dl className="task-detail-grid task-progress-meta">
          <div>
            <dt>最后更新进展</dt>
            <dd>
              {task.last_progress_at ? (
                <DateDisplay kind="date-time" value={task.last_progress_at} />
              ) : (
                '尚无进展'
              )}
            </dd>
          </div>
          <div>
            <dt>最后更新人</dt>
            <dd>{task.last_progress_by_display_name ?? '—'}</dd>
          </div>
        </dl>

        {canWriteProgress ? (
          <form
            className="task-progress-form"
            onSubmit={(event) => {
              event.preventDefault()
              beginProgressSubmit()
            }}
          >
            <h4>更新进展</h4>
            {task.status === 'blocked' && (
              <p className="muted">
                任务当前仍处于阻塞状态；填写进展不会自动恢复，请使用上方“恢复进行中”。
              </p>
            )}
            <div className="task-progress-form-grid">
              <InputField
                error={progressErrors.recordDate}
                label="进展日期"
                onChange={(event) =>
                  updateProgressField('recordDate', event.target.value)
                }
                required
                type="date"
                value={progressForm.recordDate}
              />
              <InputField
                error={progressErrors.progress}
                inputMode="numeric"
                label="当前完成比例"
                max="100"
                min="0"
                onChange={(event) =>
                  updateProgressField('progress', event.target.value)
                }
                required
                step="1"
                type="number"
                value={progressForm.progress}
              />
            </div>
            <TextareaField
              description={`${progressForm.completedContent.length}/${TASK_PROGRESS_LIMITS.completedContent}`}
              error={progressErrors.completedContent}
              label="今日完成内容"
              maxLength={TASK_PROGRESS_LIMITS.completedContent}
              onChange={(event) =>
                updateProgressField('completedContent', event.target.value)
              }
              required
              rows={5}
              value={progressForm.completedContent}
            />
            <div className="task-progress-form-grid">
              <TextareaField
                description={`${progressForm.issues.length}/${TASK_PROGRESS_LIMITS.issues}`}
                error={progressErrors.issues}
                label="遇到的问题"
                maxLength={TASK_PROGRESS_LIMITS.issues}
                onChange={(event) =>
                  updateProgressField('issues', event.target.value)
                }
                rows={4}
                value={progressForm.issues}
              />
              <TextareaField
                description={`${progressForm.nextSteps.length}/${TASK_PROGRESS_LIMITS.nextSteps}`}
                error={progressErrors.nextSteps}
                label="下一步计划"
                maxLength={TASK_PROGRESS_LIMITS.nextSteps}
                onChange={(event) =>
                  updateProgressField('nextSteps', event.target.value)
                }
                rows={4}
                value={progressForm.nextSteps}
              />
            </div>
            <label className="task-progress-check">
              <input
                checked={progressForm.needsAssistance}
                onChange={(event) =>
                  updateProgressField('needsAssistance', event.target.checked)
                }
                type="checkbox"
              />
              <span>需要协助</span>
            </label>
            {task.status === 'in_progress' && (
              <div className="task-progress-block-option">
                <label className="task-progress-check">
                  <input
                    checked={progressForm.markBlocked}
                    onChange={(event) =>
                      updateProgressField('markBlocked', event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>提交进展时同时将任务标记为阻塞</span>
                </label>
                {progressErrors.markBlocked && (
                  <small className="field-error">
                    {progressErrors.markBlocked}
                  </small>
                )}
                {progressForm.markBlocked && (
                  <TextareaField
                    description={`${progressForm.blockerReason.length}/${TASK_PROGRESS_LIMITS.blockerReason}；提交前还会再次确认状态变化。`}
                    error={progressErrors.blockerReason}
                    label="阻塞原因"
                    maxLength={TASK_PROGRESS_LIMITS.blockerReason}
                    onChange={(event) =>
                      updateProgressField('blockerReason', event.target.value)
                    }
                    required
                    rows={4}
                    value={progressForm.blockerReason}
                  />
                )}
              </div>
            )}
            {progressError && !progressConfirmOpen && (
              <p role="alert">{progressError}</p>
            )}
            <div className="task-progress-form-actions">
              <Button
                disabled={actionBusy}
                loading={progressLoading}
                type="submit"
              >
                提交进展
              </Button>
            </div>
          </form>
        ) : task.status === 'todo' ? (
          <p className="muted">请先开始任务，进入进行中后再记录执行进展。</p>
        ) : task.status === 'blocked' &&
          task.assignee_id !== auth.appUser.id ? (
          <p className="muted">只有当前任务负责人可以新增进展。</p>
        ) : ['pending_review', 'completed', 'cancelled'].includes(
            task.status,
          ) ? (
          <p className="muted">当前任务状态不允许新增执行进展。</p>
        ) : (
          <p className="muted">只有当前任务负责人可以新增进展。</p>
        )}
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

      <section className="task-detail-card task-progress-timeline">
        <h3>进展时间线</h3>
        {latestFirstUpdates.length === 0 ? (
          <p className="muted">还没有进展记录。</p>
        ) : (
          <ol className="task-progress-list">
            {latestFirstUpdates.map((item) => (
              <li key={item.update_id}>
                <div className="task-progress-item-heading">
                  <div>
                    <strong>
                      {item.created_by_display_name} · {item.record_date}
                    </strong>
                    <span>当前进度 {item.progress}%</span>
                  </div>
                  <span>#{item.sequence}</span>
                </div>
                <p>{item.completed_content}</p>
                {item.issues && <p>遇到的问题：{item.issues}</p>}
                {item.next_steps && <p>下一步计划：{item.next_steps}</p>}
                <div className="task-progress-flags">
                  {item.needs_assistance && (
                    <Badge className="badge-info">需要协助</Badge>
                  )}
                  {item.is_blocked && (
                    <Badge className="badge-warning">当时处于阻塞</Badge>
                  )}
                </div>
                <DateDisplay kind="date-time" value={item.created_at} />
              </li>
            ))}
          </ol>
        )}
      </section>

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
        confirmLabel="确认提交并标记阻塞"
        confirmLoading={progressLoading}
        description="本次提交会同时写入进展、更新完成比例，并把任务从进行中变为阻塞。所有变化将在同一个数据库事务中完成。"
        onClose={() => {
          if (progressLoading) return
          setProgressConfirmOpen(false)
          setProgressError(null)
        }}
        onConfirm={() => void runProgressUpdate()}
        open={progressConfirmOpen}
        title="确认同时标记阻塞？"
      >
        <p>阻塞原因：{progressForm.blockerReason.trim()}</p>
        {progressError && <p role="alert">{progressError}</p>}
      </Dialog>

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
