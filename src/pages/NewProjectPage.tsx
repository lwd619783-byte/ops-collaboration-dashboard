import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { UnauthorizedState } from '@/components/feedback/UnauthorizedState'
import { ProjectForm } from '@/features/projects/ProjectForm'
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
    setSubmitting(true)
    setServiceError(null)
    const idempotencyKey = requestKey ?? crypto.randomUUID()
    setRequestKey(idempotencyKey)
    const result = await projects.create({
      workspaceId: currentWorkspace.workspace_id,
      name: values.name,
      description: values.description,
      projectType: values.projectType,
      initialStatus: values.status === 'active' ? 'active' : 'planning',
      startDate: values.startDate || null,
      dueDate: values.dueDate || null,
      idempotencyKey,
    })
    if (!result.ok) {
      setServiceError(result.error.message)
      setSubmitting(false)
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
