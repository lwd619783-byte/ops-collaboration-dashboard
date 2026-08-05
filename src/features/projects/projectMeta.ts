import type { ProjectStatus, ProjectType } from '@/features/projects/types'

export const projectTypeLabels: Record<ProjectType, string> = {
  operations: '运维项目',
}

export const projectStatusLabels: Record<ProjectStatus, string> = {
  planning: '筹备中',
  active: '进行中',
  paused: '暂停',
  completed: '已完成',
  archived: '已归档',
}

export const projectStatusBadgeClasses: Record<ProjectStatus, string> = {
  planning: 'badge-neutral',
  active: 'badge-success',
  paused: 'badge-warning',
  completed: 'badge-info',
  archived: 'badge-neutral',
}

export const editableStatusTransitions: Record<
  Exclude<ProjectStatus, 'archived'>,
  Exclude<ProjectStatus, 'archived'>[]
> = {
  planning: ['planning', 'active'],
  active: ['active', 'paused', 'completed'],
  paused: ['paused', 'active'],
  completed: ['completed'],
}
