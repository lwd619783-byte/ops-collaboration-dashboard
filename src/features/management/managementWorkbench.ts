import type { Project } from '@/features/projects'
import { canManageProjectTasks } from '@/features/tasks/taskMeta'
import type { TaskSummary } from '@/features/tasks/types'
import type { WorkspaceRole } from '@/features/workspaces'

export const MANAGEMENT_STALE_DAYS = 7
export const MANAGEMENT_DUE_SOON_DAYS = 3
export const MANAGEMENT_RECENT_TASK_LIMIT = 10

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

export const managementAttentionKinds = [
  'overdue',
  'blocked',
  'pending_review',
  'stale',
] as const

export type ManagementAttentionKind = (typeof managementAttentionKinds)[number]

export const managementAttentionLabels: Record<
  ManagementAttentionKind,
  string
> = {
  overdue: '逾期',
  blocked: '阻塞',
  pending_review: '待验收',
  stale: '长期未更新',
}

export type ManagementHealth =
  'red' | 'yellow' | 'green' | 'neutral' | 'unknown'

export const managementHealthLabels: Record<ManagementHealth, string> = {
  red: '高风险',
  yellow: '需关注',
  green: '正常',
  neutral: '已完成/归档',
  unknown: '数据不完整',
}

export type ManagementTaskSignals = {
  overdue: boolean
  blocked: boolean
  pendingReview: boolean
  stale: boolean
  dueSoon: boolean
}

export type ManagementProjectTaskLoad =
  | { status: 'ready'; tasks: readonly TaskSummary[] }
  | { status: 'error'; error: string }

export type ManagementProjectMetrics = {
  taskCount: number
  progressPercent: number
  overdueCount: number
  blockedCount: number
  pendingReviewCount: number
  staleCount: number
  dueSoonCount: number
}

export type ManagementProjectView = {
  project: Project
  health: ManagementHealth
  metrics: ManagementProjectMetrics | null
  taskLoadError: string | null
}

export type ManagementTaskItem = {
  project: Project
  task: TaskSummary
  signals: ManagementTaskSignals
  attentionKinds: ManagementAttentionKind[]
}

export type ManagementWorkbenchSummary = {
  redProjects: number
  yellowProjects: number
  overdueTasks: number
  blockedTasks: number
  pendingReviewTasks: number
  staleTasks: number
}

export type ManagementWorkbenchSnapshot = {
  projects: ManagementProjectView[]
  attentionItems: ManagementTaskItem[]
  recentTasks: ManagementTaskItem[]
  summary: ManagementWorkbenchSummary
  loadedProjectCount: number
  totalProjectCount: number
  hasPartialFailure: boolean
}

function dateOnlyDayNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  const parsed = new Date(timestamp)
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null
  }
  return Math.floor(timestamp / DAY_MILLISECONDS)
}

export function calendarDayDistance(
  fromDate: string,
  toDate: string,
): number | null {
  const from = dateOnlyDayNumber(fromDate)
  const to = dateOnlyDayNumber(toDate)
  return from === null || to === null ? null : to - from
}

export function isManagementTaskTerminal(
  task: Pick<TaskSummary, 'status'>,
): boolean {
  return task.status === 'completed' || task.status === 'cancelled'
}

export function isManagementTaskOverdue(
  task: Pick<TaskSummary, 'due_date' | 'status'>,
  today: string,
): boolean {
  if (isManagementTaskTerminal(task) || task.due_date === null) return false
  const distance = calendarDayDistance(today, task.due_date)
  return distance !== null && distance < 0
}

export function isManagementTaskDueSoon(
  task: Pick<TaskSummary, 'due_date' | 'status'>,
  today: string,
): boolean {
  if (isManagementTaskTerminal(task) || task.due_date === null) return false
  const distance = calendarDayDistance(today, task.due_date)
  return (
    distance !== null && distance >= 0 && distance <= MANAGEMENT_DUE_SOON_DAYS
  )
}

export function isManagementTaskStale(
  task: Pick<TaskSummary, 'status' | 'updated_at'>,
  now: Date,
): boolean {
  if (isManagementTaskTerminal(task)) return false
  const updatedAt = Date.parse(task.updated_at)
  if (Number.isNaN(updatedAt)) return false
  return now.getTime() - updatedAt >= MANAGEMENT_STALE_DAYS * DAY_MILLISECONDS
}

function isProjectDeadlineOverdue(project: Project, today: string): boolean {
  if (project.due_date === null) return false
  const distance = calendarDayDistance(today, project.due_date)
  return distance !== null && distance < 0
}

function isProjectDeadlineDueSoon(project: Project, today: string): boolean {
  if (project.due_date === null) return false
  const distance = calendarDayDistance(today, project.due_date)
  return (
    distance !== null && distance >= 0 && distance <= MANAGEMENT_DUE_SOON_DAYS
  )
}

export function getManagementTaskSignals(
  task: TaskSummary,
  today: string,
  now: Date,
): ManagementTaskSignals {
  return {
    overdue: isManagementTaskOverdue(task, today),
    blocked: task.status === 'blocked',
    pendingReview: task.status === 'pending_review',
    stale: isManagementTaskStale(task, now),
    dueSoon: isManagementTaskDueSoon(task, today),
  }
}

function attentionKindsForSignals(
  signals: ManagementTaskSignals,
): ManagementAttentionKind[] {
  const kinds: ManagementAttentionKind[] = []
  if (signals.overdue) kinds.push('overdue')
  if (signals.blocked) kinds.push('blocked')
  if (signals.pendingReview) kinds.push('pending_review')
  if (signals.stale) kinds.push('stale')
  return kinds
}

export function calculateManagementProjectProgress(
  tasks: readonly Pick<TaskSummary, 'status'>[],
): number {
  const countedTasks = tasks.filter((task) => task.status !== 'cancelled')
  if (countedTasks.length === 0) return 0
  const completed = countedTasks.filter(
    (task) => task.status === 'completed',
  ).length
  return Math.round((completed / countedTasks.length) * 100)
}

function createMetrics(
  tasks: readonly TaskSummary[],
  today: string,
  now: Date,
): ManagementProjectMetrics {
  const signals = tasks.map((task) =>
    getManagementTaskSignals(task, today, now),
  )
  return {
    taskCount: tasks.length,
    progressPercent: calculateManagementProjectProgress(tasks),
    overdueCount: signals.filter((item) => item.overdue).length,
    blockedCount: signals.filter((item) => item.blocked).length,
    pendingReviewCount: signals.filter((item) => item.pendingReview).length,
    staleCount: signals.filter((item) => item.stale).length,
    dueSoonCount: signals.filter((item) => item.dueSoon).length,
  }
}

export function calculateManagementProjectHealth(
  project: Project,
  taskLoad: ManagementProjectTaskLoad,
  today: string,
  now: Date,
): ManagementHealth {
  if (taskLoad.status === 'error') return 'unknown'
  if (project.status === 'completed' || project.status === 'archived') {
    return 'neutral'
  }
  const signals = taskLoad.tasks.map((task) =>
    getManagementTaskSignals(task, today, now),
  )
  if (
    signals.some((item) => item.overdue || item.blocked) ||
    isProjectDeadlineOverdue(project, today)
  ) {
    return 'red'
  }
  if (
    signals.some((item) => item.pendingReview || item.stale || item.dueSoon) ||
    project.status === 'paused' ||
    isProjectDeadlineDueSoon(project, today)
  ) {
    return 'yellow'
  }
  return 'green'
}

export function selectManageableProjects(
  projects: readonly Project[],
  workspaceRole: WorkspaceRole,
  appUserId: string,
): Project[] {
  return projects.filter((project) =>
    canManageProjectTasks(project, workspaceRole, appUserId),
  )
}

const healthRank: Record<ManagementHealth, number> = {
  red: 0,
  unknown: 1,
  yellow: 2,
  green: 3,
  neutral: 4,
}

const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3 } as const

function compareTimestampsDescending(left: string, right: string): number {
  const leftTimestamp = Date.parse(left)
  const rightTimestamp = Date.parse(right)
  if (!Number.isNaN(leftTimestamp) && !Number.isNaN(rightTimestamp)) {
    const difference = rightTimestamp - leftTimestamp
    if (difference !== 0) return difference
  }
  return right.localeCompare(left)
}

function compareTaskItems(
  left: ManagementTaskItem,
  right: ManagementTaskItem,
): number {
  if (left.task.due_date !== right.task.due_date) {
    if (left.task.due_date === null) return 1
    if (right.task.due_date === null) return -1
    const dueDifference = left.task.due_date.localeCompare(right.task.due_date)
    if (dueDifference !== 0) return dueDifference
  }
  const priorityDifference =
    priorityRank[left.task.priority] - priorityRank[right.task.priority]
  if (priorityDifference !== 0) return priorityDifference
  const updatedDifference = compareTimestampsDescending(
    left.task.updated_at,
    right.task.updated_at,
  )
  if (updatedDifference !== 0) return updatedDifference
  return left.task.task_id.localeCompare(right.task.task_id)
}

export function buildManagementWorkbenchSnapshot(
  projects: readonly Project[],
  taskLoads: ReadonlyMap<string, ManagementProjectTaskLoad>,
  today: string,
  now: Date,
): ManagementWorkbenchSnapshot {
  const projectViews = projects
    .map((project): ManagementProjectView => {
      const taskLoad = taskLoads.get(project.project_id) ?? {
        status: 'error',
        error: '项目任务数据暂时无法读取。',
      }
      return {
        project,
        health: calculateManagementProjectHealth(project, taskLoad, today, now),
        metrics:
          taskLoad.status === 'ready'
            ? createMetrics(taskLoad.tasks, today, now)
            : null,
        taskLoadError: taskLoad.status === 'error' ? taskLoad.error : null,
      }
    })
    .sort(
      (left, right) =>
        healthRank[left.health] - healthRank[right.health] ||
        compareTimestampsDescending(
          left.project.updated_at,
          right.project.updated_at,
        ) ||
        left.project.project_id.localeCompare(right.project.project_id),
    )

  const uniqueTasks = new Map<string, ManagementTaskItem>()
  for (const project of projects) {
    const taskLoad = taskLoads.get(project.project_id)
    if (taskLoad?.status !== 'ready') continue
    for (const task of taskLoad.tasks) {
      if (uniqueTasks.has(task.task_id)) continue
      const signals = getManagementTaskSignals(task, today, now)
      uniqueTasks.set(task.task_id, {
        project,
        task,
        signals,
        attentionKinds: attentionKindsForSignals(signals),
      })
    }
  }

  const allTaskItems = [...uniqueTasks.values()]
  const attentionItems = allTaskItems
    .filter((item) => item.attentionKinds.length > 0)
    .sort(compareTaskItems)
  const recentTasks = [...allTaskItems]
    .sort(
      (left, right) =>
        compareTimestampsDescending(
          left.task.updated_at,
          right.task.updated_at,
        ) || left.task.task_id.localeCompare(right.task.task_id),
    )
    .slice(0, MANAGEMENT_RECENT_TASK_LIMIT)
  const loadedProjectCount = projectViews.filter(
    (item) => item.metrics !== null,
  ).length

  return {
    projects: projectViews,
    attentionItems,
    recentTasks,
    summary: {
      redProjects: projectViews.filter((item) => item.health === 'red').length,
      yellowProjects: projectViews.filter((item) => item.health === 'yellow')
        .length,
      overdueTasks: allTaskItems.filter((item) => item.signals.overdue).length,
      blockedTasks: allTaskItems.filter((item) => item.signals.blocked).length,
      pendingReviewTasks: allTaskItems.filter(
        (item) => item.signals.pendingReview,
      ).length,
      staleTasks: allTaskItems.filter((item) => item.signals.stale).length,
    },
    loadedProjectCount,
    totalProjectCount: projectViews.length,
    hasPartialFailure: loadedProjectCount !== projectViews.length,
  }
}
