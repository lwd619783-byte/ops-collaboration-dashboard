import type {
  TaskReviewAction,
  TaskPriority,
  TaskStatus,
  TaskStatusAction,
  TaskVisibility,
  TaskWorkloadLevel,
} from '@/features/tasks/types'
import type { Project } from '@/features/projects'
import type { WorkspaceRole } from '@/features/workspaces'

export const taskPriorityLabels: Record<TaskPriority, string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
}

export const taskWorkloadLabels: Record<TaskWorkloadLevel, string> = {
  xs: '很小（XS）',
  s: '小（S）',
  m: '中（M）',
  l: '大（L）',
  xl: '很大（XL）',
}

export const taskVisibilityLabels: Record<TaskVisibility, string> = {
  project: '项目可见',
  restricted: '指定人员可见',
}

export const taskStatusLabels: Record<TaskStatus, string> = {
  todo: '待开始',
  in_progress: '进行中',
  blocked: '已阻塞',
  pending_review: '待验收',
  completed: '已完成',
  cancelled: '已取消',
}

export const taskStatusActionLabels: Record<TaskStatusAction, string> = {
  start: '开始任务',
  block: '标记阻塞',
  resume: '恢复进行中',
  cancel: '取消任务',
  submit_review: '提交验收',
  approve_review: '通过验收',
  return_review: '退回修改',
}

export const taskReviewActionLabels: Record<TaskReviewAction, string> = {
  submit: '提交验收',
  approve: '通过验收',
  return: '退回修改',
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && Object.hasOwn(taskPriorityLabels, value)
}

export function isTaskWorkloadLevel(
  value: unknown,
): value is TaskWorkloadLevel {
  return typeof value === 'string' && Object.hasOwn(taskWorkloadLabels, value)
}

export function isTaskVisibility(value: unknown): value is TaskVisibility {
  return typeof value === 'string' && Object.hasOwn(taskVisibilityLabels, value)
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && Object.hasOwn(taskStatusLabels, value)
}

export function canManageProjectTasks(
  project: Project,
  workspaceRole: WorkspaceRole,
  appUserId: string,
): boolean {
  return (
    project.status !== 'archived' &&
    (workspaceRole === 'owner' ||
      workspaceRole === 'admin' ||
      project.owner_id === appUserId ||
      project.lead_id === appUserId)
  )
}
