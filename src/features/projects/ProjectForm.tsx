import { useState, type FormEvent, type ReactNode } from 'react'
import { InputField } from '@/components/forms/InputField'
import { SelectField } from '@/components/forms/SelectField'
import { TextareaField } from '@/components/forms/TextareaField'
import { Button } from '@/components/ui/Button'
import {
  projectStatusLabels,
  projectTypeLabels,
} from '@/features/projects/projectMeta'
import type {
  ProjectFormValues,
  ProjectStatus,
} from '@/features/projects/types'
import {
  PROJECT_LIMITS,
  validateProjectForm,
  type ProjectFormErrors,
} from '@/features/projects/validation'

type ProjectFormProps = {
  initialValues: ProjectFormValues
  statusOptions: Exclude<ProjectStatus, 'archived'>[]
  submitLabel: string
  submittingLabel: string
  isSubmitting: boolean
  serviceError?: string | null
  onDirty?: () => void
  onSubmit: (values: ProjectFormValues) => void
  extraFields?: ReactNode
}

export function ProjectForm({
  initialValues,
  isSubmitting,
  extraFields,
  onDirty,
  onSubmit,
  serviceError,
  statusOptions,
  submitLabel,
  submittingLabel,
}: ProjectFormProps) {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState<ProjectFormErrors>({})

  const updateField = <K extends keyof ProjectFormValues>(
    key: K,
    value: ProjectFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
    onDirty?.()
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return
    const nextErrors = validateProjectForm(values)
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    onSubmit({
      ...values,
      name: values.name.trim(),
      description: values.description.trim(),
    })
  }

  return (
    <form className="project-form" noValidate onSubmit={submit}>
      <InputField
        autoComplete="off"
        disabled={isSubmitting}
        error={errors.name}
        label="项目名称"
        maxLength={PROJECT_LIMITS.name}
        onChange={(event) => updateField('name', event.target.value)}
        required
        value={values.name}
      />
      <TextareaField
        disabled={isSubmitting}
        error={errors.description}
        label="项目描述"
        maxLength={PROJECT_LIMITS.description}
        onChange={(event) => updateField('description', event.target.value)}
        rows={6}
        value={values.description}
      />
      <div className="project-form-grid">
        <SelectField
          disabled={isSubmitting}
          error={errors.projectType}
          label="项目类型"
          onChange={(event) =>
            updateField('projectType', event.target.value as 'operations')
          }
          required
          value={values.projectType}
        >
          <option value="operations">{projectTypeLabels.operations}</option>
        </SelectField>
        <SelectField
          disabled={isSubmitting}
          error={errors.status}
          label="项目状态"
          onChange={(event) =>
            updateField(
              'status',
              event.target.value as Exclude<ProjectStatus, 'archived'>,
            )
          }
          required
          value={values.status}
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {projectStatusLabels[status]}
            </option>
          ))}
        </SelectField>
        <InputField
          disabled={isSubmitting}
          error={errors.startDate}
          label="开始日期"
          onChange={(event) => updateField('startDate', event.target.value)}
          type="date"
          value={values.startDate}
        />
        <InputField
          disabled={isSubmitting}
          error={errors.dueDate}
          label="截止日期"
          min={values.startDate || undefined}
          onChange={(event) => updateField('dueDate', event.target.value)}
          type="date"
          value={values.dueDate}
        />
      </div>
      {extraFields}
      {serviceError && (
        <p className="form-error" role="alert">
          {serviceError}
        </p>
      )}
      <div className="project-form-actions">
        <Button loading={isSubmitting} type="submit">
          {isSubmitting ? submittingLabel : submitLabel}
        </Button>
      </div>
    </form>
  )
}
