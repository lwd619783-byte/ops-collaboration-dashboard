export const taskStatuses = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'pending_review',
  'completed',
  'cancelled',
] as const
export type TaskStatus = (typeof taskStatuses)[number]
export const taskStatusMeta: {
  [K in TaskStatus]: { label: string; tone: string }
} = {
  backlog: { label: '待规划', tone: 'neutral' },
  todo: { label: '待开始', tone: 'info' },
  in_progress: { label: '进行中', tone: 'info' },
  blocked: { label: '已阻塞', tone: 'danger' },
  pending_review: { label: '待验收', tone: 'warning' },
  completed: { label: '已完成', tone: 'success' },
  cancelled: { label: '已取消', tone: 'neutral' },
}
