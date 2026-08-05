import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { UnauthorizedState } from '@/components/feedback/UnauthorizedState'
import { ProjectForm } from '@/features/projects/ProjectForm'
import { createSafeProjectError } from '@/features/projects/errors'
import { useProjects, type ProjectFormValues } from '@/features/projects'
import { useWorkspace } from '@/features/workspaces'

const initialValues: ProjectFormValues = {
  name: '',
  description: '',
  projectType: 'operations',
  status: 'planning',
  startDate: '',
  dueDate: '',
}

export function NewProjectPage() {
  const workspace = useWorkspace()
  const projects = useProjects()
  const navigate = useNavigate()
  const currentWorkspace = workspace.currentWorkspace
  const [isSubmitting, setSubmitting] = useState(false)
  const [serviceError, setServiceError] = useState<string | null>(null)
  const [requestKey, setRequestKey] = useState<string | null>(null)
  const canManage =
    currentWorkspace?.role === 'owner' || currentWorkspace?.role === 'admin'

  const actionEpochRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      actionEpochRef.current += 1
    }
  }, [])

  // Stable submit-scope key: workspace + management capability. Switching the
  // workspace (or losing management permission) invalidates any in-flight
  // create and resets the form UI so a stale response can never navigate to the
  // old project or paint an error into the new workspace's form.
  const scopeKey = currentWorkspace
    ? `${currentWorkspace.workspace_id}:${canManage ? 'manage' : 'readonly'}`
    : null
  const scopeKeyRef = useRef(scopeKey)
  // A scope transition (workspace / management capability) must also invalidate
  // any in-flight create. A workspace A -> B -> A cycle leaves the string scope
  // identical to the one that launched the original create, so the stale
  // response would otherwise pass the scope guard and navigate to the old
  // project. Bumping the action epoch on every transition makes the original
  // epoch stale regardless of how the scope string evolves. `requestEpochRef`
  // (loads) and `actionEpochRef` (mutations) stay independent.
  useLayoutEffect(() => {
    if (scopeKeyRef.current !== scopeKey) {
      actionEpochRef.current += 1
      scopeKeyRef.current = scopeKey
    }
  }, [scopeKey])

  // A scope change (workspace or management capability) must reset the form UI
  // so a stale response can never navigate to the old project or paint an error
  // into the new workspace's form. We reset during render (the documented
  // "reset when a key changes" pattern): the committed scope key is a state, so
  // comparing it to the current scope key is a pure render-time check with no
  // ref access and no effect body. Stale responses are discarded by the submit
  // handler's scope/epoch guard instead.
  const [committedScopeKey, setCommittedScopeKey] = useState(scopeKey)
  if (committedScopeKey !== scopeKey) {
    setCommittedScopeKey(scopeKey)
    setSubmitting(false)
    setServiceError(null)
    setRequestKey(null)
  }

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

  const submit = async (values: ProjectFormValues) => {
    if (isSubmitting) return
    // Capture the submitting context so a later response can only be applied if
    // the scope is still identical and the action epoch is still current.
    const actionScopeKey = scopeKeyRef.current
    const actionWorkspaceId = currentWorkspace.workspace_id
    const actionEpoch = ++actionEpochRef.current
    const idempotencyKey = requestKey ?? crypto.randomUUID()
    setRequestKey(idempotencyKey)
    setSubmitting(true)
    setServiceError(null)
    const result = await projects.create({
      workspaceId: actionWorkspaceId,
      name: values.name,
      description: values.description,
      projectType: values.projectType,
      initialStatus: values.status === 'active' ? 'active' : 'planning',
      startDate: values.startDate || null,
      dueDate: values.dueDate || null,
      idempotencyKey,
    })
    if (!mountedRef.current) return
    if (actionEpochRef.current !== actionEpoch) return
    if (actionScopeKey !== scopeKeyRef.current) return
    const stillCanManage =
      currentWorkspace?.role === 'owner' || currentWorkspace?.role === 'admin'
    if (!stillCanManage) return
    if (!result.ok) {
      setServiceError(result.error.message)
      setSubmitting(false)
      return
    }
    // Only navigate when the created project belongs to the workspace that
    // initiated the request. A mismatched workspace is a safe-failure: end the
    // submitting state, surface a unified message, and keep the current scope's
    // idempotency key and form so the user can retry.
    if (result.data.workspace_id !== actionWorkspaceId) {
      setSubmitting(false)
      setServiceError(createSafeProjectError('unknown_service_error').message)
      return
    }
    navigate(`/projects/${result.data.project_id}`, { replace: true })
  }

  return (
    <div className="page-stack project-editor-page">
      <section className="intro">
        <div>
          <p className="eyebrow">{currentWorkspace.workspace_name}</p>
          <h2>创建运维项目</h2>
          <p>创建成功后，你会自动成为项目 owner，并进入项目详情。</p>
        </div>
        <Link className="text-link" to="/projects">
          返回项目列表
        </Link>
      </section>
      <ProjectForm
        key={scopeKey ?? 'new'}
        initialValues={initialValues}
        isSubmitting={isSubmitting}
        onDirty={() => {
          setRequestKey(null)
          setServiceError(null)
        }}
        onSubmit={(values) => void submit(values)}
        serviceError={serviceError}
        statusOptions={['planning', 'active']}
        submitLabel="创建项目"
        submittingLabel="正在创建"
      />
    </div>
  )
}
