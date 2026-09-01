import type { Project, ProjectMember } from '@/features/projects'
import {
  calendarDayDistance,
  MANAGEMENT_DUE_SOON_DAYS,
} from '@/features/management/managementWorkbench'
import type { TaskSummary } from '@/features/tasks'

export const teamLoadExecutionStatuses = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
] as const

export type TeamLoadSignal = 'risk' | 'pressure' | 'active' | 'clear'

export const teamLoadSignalLabels: Record<TeamLoadSignal, string> = {
  risk: '有风险事项',
  pressure: '近期任务集中',
  active: '常规执行',
  clear: '当前无执行任务',
}

export type TeamLoadProjectBundleLoad =
  | {
      status: 'ready'
      members: readonly ProjectMember[]
      tasks: readonly TaskSummary[]
    }
  | { status: 'error'; error: string }

export type TeamLoadMember = {
  appUserId: string
  displayName: string
  projectIds: string[]
  projectNames: string[]
  executionTaskCount: number
  highPriorityCount: number
  blockedCount: number
  overdueCount: number
  dueSoonCount: number
  knownRemainingHours: number
  estimatedTaskCount: number
  signal: TeamLoadSignal
}

export type TeamLoadSummary = {
  memberCount: number
  executionTaskCount: number
  highPriorityCount: number
  blockedCount: number
  overdueCount: number
  knownRemainingHours: number
  estimatedTaskCount: number
}

export type TeamLoadSnapshot = {
  members: TeamLoadMember[]
  summary: TeamLoadSummary
  loadedProjectCount: number
  totalProjectCount: number
  hasPartialFailure: boolean
}

export function isTeamLoadExecutionTask(task: { status: string }): boolean {
  return (teamLoadExecutionStatuses as readonly string[]).includes(task.status)
}

export function calculateKnownRemainingHours(
  task: Pick<TaskSummary, 'estimated_hours' | 'progress'>,
): number | null {
  if (task.estimated_hours === null) return null
  const progress = Math.min(100, Math.max(0, task.progress))
  return Math.max(0, task.estimated_hours * (1 - progress / 100))
}

export function formatTeamLoadHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
}

function isOverdue(task: TaskSummary, today: string): boolean {
  if (task.due_date === null) return false
  const distance = calendarDayDistance(today, task.due_date)
  return distance !== null && distance < 0
}

function isDueSoon(task: TaskSummary, today: string): boolean {
  if (task.due_date === null) return false
  const distance = calendarDayDistance(today, task.due_date)
  return (
    distance !== null && distance >= 0 && distance <= MANAGEMENT_DUE_SOON_DAYS
  )
}

function signalFor(member: TeamLoadMember): TeamLoadSignal {
  if (member.executionTaskCount === 0) return 'clear'
  if (member.blockedCount > 0 || member.overdueCount > 0) return 'risk'
  if (member.highPriorityCount > 0 || member.dueSoonCount > 0) {
    return 'pressure'
  }
  return 'active'
}

export function sortTeamLoadMembers(
  members: readonly TeamLoadMember[],
): TeamLoadMember[] {
  return [...members].sort(
    (left, right) =>
      right.blockedCount - left.blockedCount ||
      right.overdueCount - left.overdueCount ||
      right.highPriorityCount - left.highPriorityCount ||
      right.dueSoonCount - left.dueSoonCount ||
      right.executionTaskCount - left.executionTaskCount ||
      right.knownRemainingHours - left.knownRemainingHours ||
      left.displayName.localeCompare(right.displayName, 'zh-CN') ||
      left.appUserId.localeCompare(right.appUserId),
  )
}

export function buildTeamLoadSnapshot(
  projects: readonly Project[],
  bundleLoads: ReadonlyMap<string, TeamLoadProjectBundleLoad>,
  today: string,
): TeamLoadSnapshot {
  const members = new Map<string, TeamLoadMember>()

  for (const project of projects) {
    const bundle = bundleLoads.get(project.project_id)
    if (bundle?.status !== 'ready') continue

    for (const member of bundle.members) {
      if (!member.is_active) continue
      const current = members.get(member.app_user_id)
      if (current) {
        if (!current.projectIds.includes(project.project_id)) {
          current.projectIds.push(project.project_id)
          current.projectNames.push(project.name)
        }
        continue
      }
      members.set(member.app_user_id, {
        appUserId: member.app_user_id,
        displayName: member.display_name,
        projectIds: [project.project_id],
        projectNames: [project.name],
        executionTaskCount: 0,
        highPriorityCount: 0,
        blockedCount: 0,
        overdueCount: 0,
        dueSoonCount: 0,
        knownRemainingHours: 0,
        estimatedTaskCount: 0,
        signal: 'clear',
      })
    }

    for (const task of bundle.tasks) {
      if (!isTeamLoadExecutionTask(task)) continue
      const member = members.get(task.assignee_id)
      if (!member) continue
      member.executionTaskCount += 1
      if (task.priority === 'urgent' || task.priority === 'high') {
        member.highPriorityCount += 1
      }
      if (task.status === 'blocked') member.blockedCount += 1
      if (isOverdue(task, today)) member.overdueCount += 1
      if (isDueSoon(task, today)) member.dueSoonCount += 1
      const remainingHours = calculateKnownRemainingHours(task)
      if (remainingHours !== null) {
        member.estimatedTaskCount += 1
        member.knownRemainingHours += remainingHours
      }
    }
  }

  for (const member of members.values()) {
    member.signal = signalFor(member)
  }

  const sortedMembers = sortTeamLoadMembers([...members.values()])
  const loadedProjectCount = projects.filter(
    (project) => bundleLoads.get(project.project_id)?.status === 'ready',
  ).length

  return {
    members: sortedMembers,
    summary: {
      memberCount: sortedMembers.length,
      executionTaskCount: sortedMembers.reduce(
        (total, member) => total + member.executionTaskCount,
        0,
      ),
      highPriorityCount: sortedMembers.reduce(
        (total, member) => total + member.highPriorityCount,
        0,
      ),
      blockedCount: sortedMembers.reduce(
        (total, member) => total + member.blockedCount,
        0,
      ),
      overdueCount: sortedMembers.reduce(
        (total, member) => total + member.overdueCount,
        0,
      ),
      knownRemainingHours: sortedMembers.reduce(
        (total, member) => total + member.knownRemainingHours,
        0,
      ),
      estimatedTaskCount: sortedMembers.reduce(
        (total, member) => total + member.estimatedTaskCount,
        0,
      ),
    },
    loadedProjectCount,
    totalProjectCount: projects.length,
    hasPartialFailure: loadedProjectCount !== projects.length,
  }
}
