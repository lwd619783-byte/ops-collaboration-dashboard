import { useId, useState, type FormEvent } from 'react'
import { InputField } from '@/components/forms/InputField'
import { SelectField } from '@/components/forms/SelectField'
import { TextareaField } from '@/components/forms/TextareaField'
import { Button } from '@/components/ui/Button'
import {
  taskPriorityLabels,
  taskVisibilityLabels,
  taskWorkloadLabels,
} from '@/features/tasks/taskMeta'
import type {
  TaskAssignmentCandidate,
  TaskFormValues,
  TaskPriority,
  TaskVisibility,
  TaskWorkloadLevel,
} from '@/features/tasks/types'
import {
  TASK_LIMITS,
  validateTaskForm,
  type TaskFormErrors,
} from '@/features/tasks/validation'
import type { ProjectModule } from '@/features/projects'

type TaskFormProps = {
  initialValues: TaskFormValues
  modules: ProjectModule[]
  candidates: TaskAssignmentCandidate[]
  isSubmitting: boolean
  submitLabel: string
  submittingLabel: string
  serviceError?: string | null
  onDirty?: () => void
  onSubmit: (values: TaskFormValues) => void
}

type PeopleFieldProps = {
  candidates: TaskAssignmentCandidate[]
  description: string
  disabled: boolean
  error?: string
  legend: string
  onChange: (ids: string[]) => void
  selectedIds: string[]
}

function PeopleField({
  candidates,
  description,
  disabled,
  error,
  legend,
  onChange,
  selectedIds,
}: PeopleFieldProps) {
  const descriptionId = useId()
  const errorId = useId()
  const toggle = (userId: string, selected: boolean) => {
    onChange(
      selected
        ? [...selectedIds, userId]
        : selectedIds.filter((id) => id !== userId),
    )
  }

  return (
    <fieldset
      aria-describedby={`${descriptionId}${error ? ` ${errorId}` : ''}`}
      aria-invalid={Boolean(error) || undefined}
      className="task-people-field"
    >
      <legend>{legend}</legend>
      <small id={descriptionId}>{description}</small>
      <div className="task-people-options">
        {candidates.map((candidate) => (
          <label key={candidate.app_user_id}>
            <input
              checked={selectedIds.includes(candidate.app_user_id)}
              disabled={disabled}
              onChange={(event) =>
                toggle(candidate.app_user_id, event.target.checked)
              }
              type="checkbox"
            />
            <span>
              {candidate.display_name}
              <small>{candidate.project_role}</small>
            </span>
          </label>
        ))}
      </div>
      {candidates.length === 0 && (
        <p className="task-people-empty">没有可选人员。</p>
      )}
      {error && (
        <small className="field-error" id={errorId}>
          {error}
        </small>
      )}
    </fieldset>
  )
}

const priorityOptions = Object.keys(taskPriorityLabels) as TaskPriority[]
const workloadOptions = Object.keys(taskWorkloadLabels) as TaskWorkloadLevel[]
const visibilityOptions = Object.keys(taskVisibilityLabels) as TaskVisibility[]

export function TaskForm({
  candidates,
  initialValues,
  isSubmitting,
  modules,
  onDirty,
  onSubmit,
  serviceError,
  submitLabel,
  submittingLabel,
}: TaskFormProps) {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState<TaskFormErrors>({})
  const responsibilityCandidates = candidates.filter(
    (candidate) => candidate.can_hold_responsibility,
  )

  const updateField = <K extends keyof TaskFormValues>(
    key: K,
    value: TaskFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
    onDirty?.()
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return
    const nextErrors = validateTaskForm(values)
    const validModuleIds = new Set(modules.map((module) => module.module_id))
    const responsibilityIds = new Set(
      responsibilityCandidates.map((candidate) => candidate.app_user_id),
    )
    const visibilityIds = new Set(
      candidates.map((candidate) => candidate.app_user_id),
    )
    if (!validModuleIds.has(values.moduleId)) {
      nextErrors.moduleId = '请选择当前项目中的有效模块。'
    }
    if (!responsibilityIds.has(values.assigneeId)) {
      nextErrors.assigneeId = '请选择可承担任务职责的当前项目成员。'
    }
    if (!responsibilityIds.has(values.reviewerId)) {
      nextErrors.reviewerId = '请选择可承担验收职责的当前项目成员。'
    }
    if (values.collaboratorIds.some((id) => !responsibilityIds.has(id))) {
      nextErrors.collaboratorIds = '协作人必须是可承担职责的当前项目成员。'
    }
    if (values.visibilityUserIds.some((id) => !visibilityIds.has(id))) {
      nextErrors.visibilityUserIds = '显式可见人员必须是当前项目成员。'
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    onSubmit({
      ...values,
      title: values.title.trim(),
      description: values.description.trim(),
      acceptanceCriteria: values.acceptanceCriteria.trim(),
      estimatedHours: values.estimatedHours.trim(),
    })
  }

  const collaboratorCandidates = responsibilityCandidates.filter(
    (candidate) => candidate.app_user_id !== values.assigneeId,
  )

  return (
    <form
      aria-label="任务编辑表单"
      className="task-form"
      noValidate
      onSubmit={submit}
    >
      <InputField
        autoComplete="off"
        disabled={isSubmitting}
        error={errors.title}
        label="任务标题"
        maxLength={TASK_LIMITS.title}
        onChange={(event) => updateField('title', event.target.value)}
        required
        value={values.title}
      />
      <div className="task-form-grid">
        <SelectField
          disabled={isSubmitting}
          error={errors.moduleId}
          label="项目模块"
          onChange={(event) => updateField('moduleId', event.target.value)}
          required
          value={values.moduleId}
        >
          <option value="">请选择模块</option>
          {modules.map((module) => (
            <option key={module.module_id} value={module.module_id}>
              {module.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          disabled={isSubmitting}
          error={errors.priority}
          label="优先级"
          onChange={(event) =>
            updateField('priority', event.target.value as TaskPriority)
          }
          required
          value={values.priority}
        >
          {priorityOptions.map((priority) => (
            <option key={priority} value={priority}>
              {taskPriorityLabels[priority]}
            </option>
          ))}
        </SelectField>
        <SelectField
          disabled={isSubmitting}
          error={errors.assigneeId}
          label="主要负责人"
          onChange={(event) => {
            const nextAssigneeId = event.target.value
            updateField('assigneeId', nextAssigneeId)
            if (values.collaboratorIds.includes(nextAssigneeId)) {
              updateField(
                'collaboratorIds',
                values.collaboratorIds.filter((id) => id !== nextAssigneeId),
              )
            }
          }}
          required
          value={values.assigneeId}
        >
          <option value="">请选择负责人</option>
          {responsibilityCandidates.map((candidate) => (
            <option key={candidate.app_user_id} value={candidate.app_user_id}>
              {candidate.display_name}
            </option>
          ))}
        </SelectField>
        <SelectField
          disabled={isSubmitting}
          error={errors.reviewerId}
          label="验收人"
          onChange={(event) => updateField('reviewerId', event.target.value)}
          required
          value={values.reviewerId}
        >
          <option value="">请选择验收人</option>
          {responsibilityCandidates.map((candidate) => (
            <option key={candidate.app_user_id} value={candidate.app_user_id}>
              {candidate.display_name}
            </option>
          ))}
        </SelectField>
      </div>

      <PeopleField
        candidates={collaboratorCandidates}
        description="可多选；主要负责人不会出现在协作人中。"
        disabled={isSubmitting}
        error={errors.collaboratorIds}
        legend="协作人"
        onChange={(ids) => updateField('collaboratorIds', ids)}
        selectedIds={values.collaboratorIds}
      />

      <div className="task-form-grid task-form-schedule">
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
        <InputField
          disabled={isSubmitting}
          error={errors.estimatedHours}
          inputMode="decimal"
          label="预计工时"
          max={TASK_LIMITS.estimatedHours}
          min="0"
          onChange={(event) =>
            updateField('estimatedHours', event.target.value)
          }
          step="0.01"
          type="number"
          value={values.estimatedHours}
        />
        <SelectField
          disabled={isSubmitting}
          error={errors.workloadLevel}
          label="工作量等级"
          onChange={(event) =>
            updateField(
              'workloadLevel',
              event.target.value as TaskWorkloadLevel,
            )
          }
          required
          value={values.workloadLevel}
        >
          {workloadOptions.map((workload) => (
            <option key={workload} value={workload}>
              {taskWorkloadLabels[workload]}
            </option>
          ))}
        </SelectField>
      </div>

      <TextareaField
        disabled={isSubmitting}
        error={errors.description}
        label="任务说明"
        maxLength={TASK_LIMITS.description}
        onChange={(event) => updateField('description', event.target.value)}
        rows={6}
        value={values.description}
      />
      <TextareaField
        disabled={isSubmitting}
        error={errors.acceptanceCriteria}
        label="验收标准"
        maxLength={TASK_LIMITS.acceptanceCriteria}
        onChange={(event) =>
          updateField('acceptanceCriteria', event.target.value)
        }
        rows={6}
        value={values.acceptanceCriteria}
      />

      <SelectField
        description="项目可见：所有仍有项目读取权限的成员可读；指定人员可见：仅管理者、任务参与者、创建者和显式授权人员可读。"
        disabled={isSubmitting}
        error={errors.visibility}
        label="任务可见性"
        onChange={(event) => {
          const visibility = event.target.value as TaskVisibility
          updateField('visibility', visibility)
          if (visibility === 'project') updateField('visibilityUserIds', [])
        }}
        required
        value={values.visibility}
      >
        {visibilityOptions.map((visibility) => (
          <option key={visibility} value={visibility}>
            {taskVisibilityLabels[visibility]}
          </option>
        ))}
      </SelectField>
      {values.visibility === 'restricted' && (
        <PeopleField
          candidates={candidates}
          description="可额外授权当前项目成员；viewer 只能在这里作为显式可见人员。"
          disabled={isSubmitting}
          error={errors.visibilityUserIds}
          legend="显式可见人员"
          onChange={(ids) => updateField('visibilityUserIds', ids)}
          selectedIds={values.visibilityUserIds}
        />
      )}

      {serviceError && (
        <p className="form-error" role="alert">
          {serviceError}
        </p>
      )}
      <div className="task-form-actions">
        <Button loading={isSubmitting} type="submit">
          {isSubmitting ? submittingLabel : submitLabel}
        </Button>
      </div>
    </form>
  )
}
