import type { TaskFormValues } from '@/features/tasks/types'
import {
  isTaskPriority,
  isTaskVisibility,
  isTaskWorkloadLevel,
} from '@/features/tasks/taskMeta'

export const TASK_LIMITS = {
  title: 200,
  description: 10000,
  acceptanceCriteria: 10000,
  estimatedHours: 10000,
} as const

export type TaskFormErrors = Partial<Record<keyof TaskFormValues, string>>

export function parseEstimatedHours(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

export function validateTaskForm(values: TaskFormValues): TaskFormErrors {
  const errors: TaskFormErrors = {}
  const title = values.title.trim()
  const description = values.description.trim()
  const acceptance = values.acceptanceCriteria.trim()
  const collaborators = new Set(values.collaboratorIds)
  const visibilityUsers = new Set(values.visibilityUserIds)

  if (title.length === 0) errors.title = '任务标题不能为空。'
  else if (title.length > TASK_LIMITS.title) {
    errors.title = `任务标题不能超过 ${TASK_LIMITS.title} 个字符。`
  }
  if (!values.moduleId) errors.moduleId = '请选择有效项目模块。'
  if (!values.assigneeId) errors.assigneeId = '请选择主要负责人。'
  if (!values.reviewerId) errors.reviewerId = '请选择验收人。'
  if (!isTaskPriority(values.priority)) errors.priority = '请选择有效优先级。'
  if (!isTaskWorkloadLevel(values.workloadLevel)) {
    errors.workloadLevel = '请选择有效工作量等级。'
  }
  if (!isTaskVisibility(values.visibility)) {
    errors.visibility = '请选择有效任务可见性。'
  }
  if (description.length > TASK_LIMITS.description) {
    errors.description = `任务说明不能超过 ${TASK_LIMITS.description} 个字符。`
  }
  if (acceptance.length > TASK_LIMITS.acceptanceCriteria) {
    errors.acceptanceCriteria = `验收标准不能超过 ${TASK_LIMITS.acceptanceCriteria} 个字符。`
  }
  if (collaborators.size !== values.collaboratorIds.length) {
    errors.collaboratorIds = '协作人不能重复。'
  } else if (collaborators.has(values.assigneeId)) {
    errors.collaboratorIds = '主要负责人不能同时作为协作人。'
  }
  if (visibilityUsers.size !== values.visibilityUserIds.length) {
    errors.visibilityUserIds = '显式可见人员不能重复。'
  }
  if (values.visibility === 'project' && values.visibilityUserIds.length > 0) {
    errors.visibilityUserIds = '项目可见任务不需要指定可见人员。'
  }
  if (values.startDate && !isDateOnly(values.startDate)) {
    errors.startDate = '请输入有效开始日期。'
  }
  if (values.dueDate && !isDateOnly(values.dueDate)) {
    errors.dueDate = '请输入有效截止日期。'
  } else if (
    values.startDate &&
    values.dueDate &&
    values.dueDate < values.startDate
  ) {
    errors.dueDate = '截止日期不得早于开始日期。'
  }
  if (values.estimatedHours.trim() !== '') {
    const hours = parseEstimatedHours(values.estimatedHours)
    if (
      hours === null ||
      hours < 0 ||
      hours > TASK_LIMITS.estimatedHours ||
      !/^\d+(?:\.\d{1,2})?$/u.test(values.estimatedHours.trim())
    ) {
      errors.estimatedHours = `预计工时须为 0–${TASK_LIMITS.estimatedHours}，最多两位小数。`
    }
  }
  return errors
}
