import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { UnauthorizedState } from '@/components/feedback/UnauthorizedState'
import { useAuth } from '@/features/auth'
import { TaskForm, useTasks, type TaskFormValues } from '@/features/tasks'
import { createSafeTaskError } from '@/features/tasks/errors'
import { canManageProjectTasks } from '@/features/tasks/taskMeta'
import { useTaskEditorResources } from '@/features/tasks/useTaskEditorResources'
import { parseEstimatedHours } from '@/features/tasks/validation'
import { useWorkspace } from '@/features/workspaces'

export function EditTaskPage() {
  const { projectId = '', taskId = '' } = useParams()
  const auth = useAuth()
  const workspace = useWorkspace()
  const tasks = useTasks()
  const navigate = useNavigate()
  const { loadState, resources, scopeKey, showLoading } =
    useTaskEditorResources(projectId, taskId)
  const [isSubmitting, setSubmitting] = useState(false)
  const [serviceError, setServiceError] = useState<string | null>(null)
  const actionEpochRef = useRef(0)
  const mountedRef = useRef(true)
  const scopeKeyRef = useRef(scopeKey)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      actionEpochRef.current += 1
    }
  }, [])

  useLayoutEffect(() => {
    if (scopeKeyRef.current !== scopeKey) {
      actionEpochRef.current += 1
      scopeKeyRef.current = scopeKey
    }
  }, [scopeKey])

  const [committedScopeKey, setCommittedScopeKey] = useState(scopeKey)
  if (committedScopeKey !== scopeKey) {
    setCommittedScopeKey(scopeKey)
    setSubmitting(false)
    setServiceError(null)
  }

  const currentWorkspace = workspace.currentWorkspace
  if (!currentWorkspace || !auth.appUser) return null
  if (showLoading) return <LoadingState title="正在加载任务编辑数据" />
  if (loadState === 'error' || !resources || !resources.task) {
    return (
      <ErrorState
        action={
          <Link className="text-link" to={`/projects/${projectId}`}>
            返回项目详情
          </Link>
        }
        description="任务不存在、你无权访问，或编辑数据暂时不可用。"
        title="无法编辑任务"
      />
    )
  }
  if (
    !canManageProjectTasks(
      resources.project,
      currentWorkspace.role,
      auth.appUser.id,
    )
  ) {
    return (
      <UnauthorizedState
        action={
          <Link
            className="text-link"
            to={`/projects/${projectId}/tasks/${taskId}`}
          >
            返回任务详情
          </Link>
        }
      />
    )
  }

  const task = resources.task
  const submit = async (values: TaskFormValues) => {
    if (isSubmitting) return
    const actionScopeKey = scopeKeyRef.current
    const actionTaskId = task.task_id
    const actionProjectId = task.project_id
    const actionWorkspaceId = task.workspace_id
    const actionEpoch = ++actionEpochRef.current
    setSubmitting(true)
    setServiceError(null)
    const result = await tasks.update({
      taskId: actionTaskId,
      projectId: actionProjectId,
      expectedUpdatedAt: task.updated_at,
      moduleId: values.moduleId,
      title: values.title,
      description: values.description,
      acceptanceCriteria: values.acceptanceCriteria,
      assigneeId: values.assigneeId,
      collaboratorIds: values.collaboratorIds,
      reviewerId: values.reviewerId,
      priority: values.priority,
      startDate: values.startDate || null,
      dueDate: values.dueDate || null,
      estimatedHours: parseEstimatedHours(values.estimatedHours),
      workloadLevel: values.workloadLevel,
      visibility: values.visibility,
      visibilityUserIds: values.visibilityUserIds,
    })
    if (!mountedRef.current || actionEpochRef.current !== actionEpoch) return
    if (actionScopeKey !== scopeKeyRef.current) return
    if (!result.ok) {
      setServiceError(result.error.message)
      setSubmitting(false)
      return
    }
    if (
      result.data.task_id !== actionTaskId ||
      result.data.project_id !== actionProjectId ||
      result.data.workspace_id !== actionWorkspaceId
    ) {
      setServiceError(createSafeTaskError('unknown_service_error').message)
      setSubmitting(false)
      return
    }
    navigate(`/projects/${actionProjectId}/tasks/${actionTaskId}`, {
      replace: true,
    })
  }

  return (
    <div className="page-stack task-editor-page">
      <section className="intro">
        <div>
          <p className="eyebrow">{resources.project.name}</p>
          <h2>编辑任务</h2>
          <p>本页只编辑 Task 3.1 核心元数据，不提供状态或进度变更。</p>
        </div>
        <Link
          className="text-link"
          to={`/projects/${projectId}/tasks/${taskId}`}
        >
          返回任务详情
        </Link>
      </section>
      <TaskForm
        candidates={resources.candidates}
        initialValues={{
          title: task.title,
          moduleId: task.module_id,
          assigneeId: task.assignee_id,
          collaboratorIds: task.collaborators.map(
            (person) => person.app_user_id,
          ),
          reviewerId: task.reviewer_id,
          priority: task.priority,
          startDate: task.start_date ?? '',
          dueDate: task.due_date ?? '',
          estimatedHours:
            task.estimated_hours === null ? '' : String(task.estimated_hours),
          workloadLevel: task.workload_level,
          description: task.description ?? '',
          acceptanceCriteria: task.acceptance_criteria ?? '',
          visibility: task.visibility,
          visibilityUserIds: task.visibility_users.map(
            (person) => person.app_user_id,
          ),
        }}
        isSubmitting={isSubmitting}
        key={`${scopeKey}:${task.updated_at}`}
        modules={resources.modules}
        onDirty={() => setServiceError(null)}
        onSubmit={(values) => void submit(values)}
        serviceError={serviceError}
        submitLabel="保存修改"
        submittingLabel="正在保存"
      />
    </div>
  )
}
