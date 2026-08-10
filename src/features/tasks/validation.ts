import type {
  TaskFormValues,
  TaskProgressFormValues,
} from '@/features/tasks/types'
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

export function isTaskDateOnly(value: string): boolean {
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
  if (values.startDate && !isTaskDateOnly(values.startDate)) {
    errors.startDate = '请输入有效开始日期。'
  }
  if (values.dueDate && !isTaskDateOnly(values.dueDate)) {
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

export const TASK_PROGRESS_LIMITS = {
  completedContent: 10000,
  issues: 10000,
  nextSteps: 10000,
  blockerReason: 2000,
} as const

export type TaskProgressFormErrors = Partial<
  Record<keyof TaskProgressFormValues, string>
>

export function currentLocalCalendarDate(now = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function validateTaskProgressForm(
  values: TaskProgressFormValues,
  status: 'in_progress' | 'blocked',
): TaskProgressFormErrors {
  const errors: TaskProgressFormErrors = {}
  const completed = values.completedContent.trim()
  const issues = values.issues.trim()
  const nextSteps = values.nextSteps.trim()
  const blockerReason = values.blockerReason.trim()
  const progress = Number(values.progress)

  if (!isTaskDateOnly(values.recordDate)) {
    errors.recordDate = '请输入有效进展日期。'
  }
  if (!completed) errors.completedContent = '请填写今日完成内容。'
  else if (completed.length > TASK_PROGRESS_LIMITS.completedContent) {
    errors.completedContent = `今日完成内容不能超过 ${TASK_PROGRESS_LIMITS.completedContent} 个字符。`
  }
  if (
    values.progress.trim() === '' ||
    !/^\d{1,3}$/u.test(values.progress.trim()) ||
    !Number.isInteger(progress) ||
    progress < 0 ||
    progress > 100
  ) {
    errors.progress = '当前完成比例须为 0–100 的整数。'
  }
  if (issues.length > TASK_PROGRESS_LIMITS.issues) {
    errors.issues = `遇到的问题不能超过 ${TASK_PROGRESS_LIMITS.issues} 个字符。`
  }
  if (nextSteps.length > TASK_PROGRESS_LIMITS.nextSteps) {
    errors.nextSteps = `下一步计划不能超过 ${TASK_PROGRESS_LIMITS.nextSteps} 个字符。`
  }
  if (status === 'blocked' && values.markBlocked) {
    errors.markBlocked = '已阻塞任务不能重复标记阻塞。'
  }
  if (values.markBlocked && !blockerReason) {
    errors.blockerReason = '请填写阻塞原因。'
  } else if (blockerReason.length > TASK_PROGRESS_LIMITS.blockerReason) {
    errors.blockerReason = `阻塞原因不能超过 ${TASK_PROGRESS_LIMITS.blockerReason} 个字符。`
  }
  return errors
}
