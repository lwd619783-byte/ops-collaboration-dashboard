import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { UnauthorizedState } from '@/components/feedback/UnauthorizedState'
import { ProjectForm } from '@/features/projects/ProjectForm'
import { editableStatusTransitions } from '@/features/projects/projectMeta'
import {
  useProjects,
  type Project,
  type ProjectFormValues,
} from '@/features/projects'
import { useWorkspace } from '@/features/workspaces'

export function EditProjectPage() {
  const { projectId = '' } = useParams()
  const workspace = useWorkspace()
  const projects = useProjects()
  const navigate = useNavigate()
  const currentWorkspace = workspace.currentWorkspace
  const [project, setProject] = useState<Project | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null)
  const [isSubmitting, setSubmitting] = useState(false)
  const [serviceError, setServiceError] = useState<string | null>(null)
  const requestEpochRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestEpochRef.current += 1
    }
  }, [])

  const canManage =
    currentWorkspace?.role === 'owner' || currentWorkspace?.role === 'admin'

  // Stable request-scope key: workspace + project id + management capability.
  // Including the permission state means a role demotion (owner/admin -> member)
  // changes the scope and discards the previously loaded management form.
  const scopeKey = currentWorkspace
    ? `${currentWorkspace.workspace_id}:${projectId}:${
        canManage ? 'manage' : 'readonly'
      }`
    : null
  const scopeKeyRef = useRef(scopeKey)
  useLayoutEffect(() => {
    scopeKeyRef.current = scopeKey
  }, [scopeKey])

  const loadProject = useCallback(async () => {
    if (!currentWorkspace || !canManage) return
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
  }, [canManage, currentWorkspace, projectId, projects])

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

  if (!currentWorkspace) return null
  if (!canManage) {
    return (
      <UnauthorizedState
        action={
          <Link className="text-link" to="/projects">
            返回项目列表
          </Link>
        }
      />
    )
  }

  // A ready payload is only trustworthy inside the scope that produced it. A
  // scope change (project id, workspace, or management role) must discard the
  // old form until the request for the current scope resolves.
  const staleScope = loadedScopeKey !== scopeKey
  const showLoading = loadState === 'loading' || staleScope

  if (showLoading) {
    return <LoadingState title="正在加载项目" />
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
        title="无法编辑项目"
      />
    )
  }
  if (project.status === 'archived') {
    return (
      <ErrorState
        action={
          <Link className="text-link" to={`/projects/${project.project_id}`}>
            返回项目详情
          </Link>
        }
        description="已归档项目不能进入普通编辑流程。"
        title="项目已归档"
      />
    )
  }

  const submit = async (values: ProjectFormValues) => {
    if (isSubmitting) return
    setSubmitting(true)
    setServiceError(null)
    const result = await projects.update({
      projectId: project.project_id,
      name: values.name,
      description: values.description,
      status: values.status,
      startDate: values.startDate || null,
      dueDate: values.dueDate || null,
      expectedUpdatedAt: project.updated_at,
    })
    if (!result.ok) {
      setServiceError(result.error.message)
      setSubmitting(false)
      return
    }
    navigate(`/projects/${project.project_id}`, { replace: true })
  }

  return (
    <div className="page-stack project-editor-page">
      <section className="intro">
        <div>
          <p className="eyebrow">{currentWorkspace.workspace_name}</p>
          <h2>编辑项目</h2>
          <p>只能修改基础信息和当前状态允许的下一步。</p>
        </div>
        <Link className="text-link" to={`/projects/${project.project_id}`}>
          返回项目详情
        </Link>
      </section>
      <ProjectForm
        initialValues={{
          name: project.name,
          description: project.description ?? '',
          projectType: project.project_type,
          status: project.status,
          startDate: project.start_date ?? '',
          dueDate: project.due_date ?? '',
        }}
        isSubmitting={isSubmitting}
        onDirty={() => setServiceError(null)}
        onSubmit={(values) => void submit(values)}
        serviceError={serviceError}
        statusOptions={editableStatusTransitions[project.status]}
        submitLabel="保存修改"
        submittingLabel="正在保存"
      />
    </div>
  )
}
