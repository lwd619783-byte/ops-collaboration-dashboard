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

const initialValues: TaskFormValues = {
  title: '',
  moduleId: '',
  assigneeId: '',
  collaboratorIds: [],
  reviewerId: '',
  priority: 'medium',
  startDate: '',
  dueDate: '',
  estimatedHours: '',
  workloadLevel: 'm',
  description: '',
  acceptanceCriteria: '',
  visibility: 'project',
  visibilityUserIds: [],
}

export function NewTaskPage() {
  const { projectId = '' } = useParams()
  const auth = useAuth()
  const workspace = useWorkspace()
  const tasks = useTasks()
  const navigate = useNavigate()
  const { loadState, resources, scopeKey, showLoading } =
    useTaskEditorResources(projectId)
  const [isSubmitting, setSubmitting] = useState(false)
  const [serviceError, setServiceError] = useState<string | null>(null)
  const [requestKey, setRequestKey] = useState<string | null>(null)
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
    setRequestKey(null)
  }

  const currentWorkspace = workspace.currentWorkspace
  if (!currentWorkspace || !auth.appUser) return null
  if (showLoading) return <LoadingState title="正在准备任务表单" />
  if (loadState === 'error' || !resources) {
    return (
      <ErrorState
        action={
          <Link className="text-link" to={`/projects/${projectId}`}>
            返回项目详情
          </Link>
        }
        description="项目不存在、你无权访问，或候选数据暂时不可用。"
        title="无法创建任务"
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
            to={`/projects/${resources.project.project_id}`}
          >
            返回项目详情
          </Link>
        }
      />
    )
  }
  if (resources.modules.length === 0) {
    return (
      <ErrorState
        action={
          <Link
            className="text-link"
            to={`/projects/${resources.project.project_id}`}
          >
            返回项目并创建模块
          </Link>
        }
        description="每个项目任务必须关联一个当前有效模块。"
        title="请先创建项目模块"
      />
    )
  }

  const submit = async (values: TaskFormValues) => {
    if (isSubmitting) return
    const actionScopeKey = scopeKeyRef.current
    const actionProjectId = resources.project.project_id
    const actionWorkspaceId = currentWorkspace.workspace_id
    const actionEpoch = ++actionEpochRef.current
    const idempotencyKey = requestKey ?? crypto.randomUUID()
    setRequestKey(idempotencyKey)
    setSubmitting(true)
    setServiceError(null)
    const result = await tasks.create({
      projectId: actionProjectId,
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
      idempotencyKey,
    })
    if (!mountedRef.current || actionEpochRef.current !== actionEpoch) return
    if (actionScopeKey !== scopeKeyRef.current) return
    if (!result.ok) {
      setServiceError(result.error.message)
      setSubmitting(false)
      return
    }
    if (
      result.data.project_id !== actionProjectId ||
      result.data.workspace_id !== actionWorkspaceId
    ) {
      setServiceError(createSafeTaskError('unknown_service_error').message)
      setSubmitting(false)
      return
    }
    navigate(
      `/projects/${result.data.project_id}/tasks/${result.data.task_id}`,
      { replace: true },
    )
  }

  return (
    <div className="page-stack task-editor-page">
      <section className="intro">
        <div>
          <p className="eyebrow">{resources.project.name}</p>
          <h2>创建项目任务</h2>
          <p>创建后任务从“待开始”、0% 进度进入共享任务基础模型。</p>
        </div>
        <Link
          className="text-link"
          to={`/projects/${resources.project.project_id}`}
        >
          返回项目详情
        </Link>
      </section>
      <TaskForm
        candidates={resources.candidates}
        initialValues={initialValues}
        isSubmitting={isSubmitting}
        key={scopeKey ?? projectId}
        modules={resources.modules}
        onDirty={() => {
          setRequestKey(null)
          setServiceError(null)
        }}
        onSubmit={(values) => void submit(values)}
        serviceError={serviceError}
        submitLabel="创建任务"
        submittingLabel="正在创建"
      />
    </div>
  )
}
