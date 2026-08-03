export const appNavigation = [
  { label: '工作台', path: '/', title: '工作台' },
  { label: '项目', path: '/projects', title: '项目' },
  { label: '我的任务', path: '/tasks', title: '我的任务' },
  { label: '团队负荷', path: '/team-load', title: '团队负荷' },
  { label: '消息中心', path: '/notifications', title: '消息中心' },
  { label: '个人空间', path: '/personal', title: '个人空间' },
  { label: '成员管理', path: '/members', title: '成员管理' },
  { label: '设置', path: '/settings', title: '设置' },
  { label: '系统健康', path: '/system-health', title: '系统健康' },
] as const

export type AppNavigationItem = (typeof appNavigation)[number]

/**
 * Legacy business paths that redirect to their canonical route inside the
 * protected area. Kept so existing bookmarks/links do not fall into the
 * public 404.
 */
export const legacyBusinessPathRedirects = [
  { from: '/my-tasks', to: '/tasks' },
] as const
