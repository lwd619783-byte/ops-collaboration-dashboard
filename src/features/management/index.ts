export { ManagementAttentionList } from '@/features/management/ManagementAttentionList'
export { ManagementHealthBadge } from '@/features/management/ManagementHealthBadge'
export { ManagementProjectCard } from '@/features/management/ManagementProjectCard'
export { ManagementRecentTasks } from '@/features/management/ManagementRecentTasks'
export { ManagementSummaryCard } from '@/features/management/ManagementSummaryCard'
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
  MANAGEMENT_TASK_LOAD_CONCURRENCY,
  mapWithConcurrency,
  useManagementWorkbench,
} from '@/features/management/useManagementWorkbench'
export type {
  ManagementWorkbenchScope,
  ManagementWorkbenchState,
} from '@/features/management/useManagementWorkbench'
