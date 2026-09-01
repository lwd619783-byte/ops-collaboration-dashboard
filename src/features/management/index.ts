export { ManagementAttentionList } from '@/features/management/ManagementAttentionList'
export { ManagementHealthBadge } from '@/features/management/ManagementHealthBadge'
export { ManagementProjectCard } from '@/features/management/ManagementProjectCard'
export { ManagementRecentTasks } from '@/features/management/ManagementRecentTasks'
export { ManagementSummaryCard } from '@/features/management/ManagementSummaryCard'
export { TeamLoadMemberCard } from '@/features/management/TeamLoadMemberCard'
export { TeamLoadSummaryCard } from '@/features/management/TeamLoadSummaryCard'
export {
  buildManagementWorkbenchSnapshot,
  calculateManagementProjectHealth,
  calculateManagementProjectProgress,
  calendarDayDistance,
  getManagementTaskSignals,
  isManagementTaskDueSoon,
  isManagementTaskOverdue,
  isManagementTaskStale,
  isManagementTaskTerminal,
  managementAttentionKinds,
  managementAttentionLabels,
  managementHealthLabels,
  MANAGEMENT_DUE_SOON_DAYS,
  MANAGEMENT_RECENT_TASK_LIMIT,
  MANAGEMENT_STALE_DAYS,
  selectManageableProjects,
} from '@/features/management/managementWorkbench'
export type {
  ManagementAttentionKind,
  ManagementHealth,
  ManagementProjectMetrics,
  ManagementProjectTaskLoad,
  ManagementProjectView,
  ManagementTaskItem,
  ManagementTaskSignals,
  ManagementWorkbenchSnapshot,
  ManagementWorkbenchSummary,
} from '@/features/management/managementWorkbench'
export {
  buildTeamLoadSnapshot,
  calculateKnownRemainingHours,
  formatTeamLoadHours,
  isTeamLoadExecutionTask,
  sortTeamLoadMembers,
  teamLoadExecutionStatuses,
  teamLoadSignalLabels,
} from '@/features/management/teamLoad'
export type {
  TeamLoadMember,
  TeamLoadProjectBundleLoad,
  TeamLoadSignal,
  TeamLoadSnapshot,
  TeamLoadSummary,
} from '@/features/management/teamLoad'
export {
  MANAGEMENT_TASK_LOAD_CONCURRENCY,
  mapWithConcurrency,
  useManagementWorkbench,
} from '@/features/management/useManagementWorkbench'
export type {
  ManagementWorkbenchScope,
  ManagementWorkbenchState,
} from '@/features/management/useManagementWorkbench'
export {
  TEAM_LOAD_PROJECT_BUNDLE_CONCURRENCY,
  useTeamLoad,
} from '@/features/management/useTeamLoad'
export type {
  TeamLoadScope,
  TeamLoadState,
} from '@/features/management/useTeamLoad'
