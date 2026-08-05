import type {
  ProjectRole,
  ProjectStatus,
  ProjectType,
} from '@/features/projects/types'
import type { WorkspaceRole } from '@/features/workspaces/types'

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

export const projectRoleLabels: Record<ProjectRole, string> = {
  owner: '项目负责人',
  lead: '项目牵头人',
  member: '项目成员',
  viewer: '只读成员',
}

export const projectRoleBadgeClasses: Record<ProjectRole, string> = {
  owner: 'badge-info',
  lead: 'badge-warning',
  member: 'badge-success',
  viewer: 'badge-neutral',
}

export const projectWorkspaceRoleLabels: Record<WorkspaceRole, string> = {
  owner: '空间所有者',
  admin: '空间管理员',
  member: '空间成员',
  external_collaborator: '外部协作者',
}

export function isProjectType(value: unknown): value is ProjectType {
  return typeof value === 'string' && Object.hasOwn(projectTypeLabels, value)
}

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === 'string' && Object.hasOwn(projectStatusLabels, value)
}

export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && Object.hasOwn(projectRoleLabels, value)
}

export function isProjectWorkspaceRole(value: unknown): value is WorkspaceRole {
  return (
    typeof value === 'string' &&
    Object.hasOwn(projectWorkspaceRoleLabels, value)
  )
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
