import type { MyTaskSummary } from '@/features/tasks/types'

export const myTaskViews = [
  'pending',
  'owned',
  'collaborating',
  'review',
  'completed',
] as const

export type MyTaskView = (typeof myTaskViews)[number]

export const myTaskViewLabels: Record<MyTaskView, string> = {
  pending: '待处理',
  owned: '我负责',
  collaborating: '我协作',
  review: '待我验收',
  completed: '已完成',
}

export function isMyTaskView(value: string | null): value is MyTaskView {
  return myTaskViews.includes(value as MyTaskView)
}

export function hasExecutionResponsibility(task: MyTaskSummary): boolean {
  return task.is_assignee || task.is_collaborator
}

export function isMyTaskActionable(task: MyTaskSummary): boolean {
  if (task.status === 'pending_review') return task.can_decide_review
  return (
    hasExecutionResponsibility(task) &&
    ['todo', 'in_progress', 'blocked'].includes(task.status)
  )
}

export function filterMyTasks(
  tasks: MyTaskSummary[],
  view: MyTaskView,
): MyTaskSummary[] {
  return tasks.filter((task) => {
    switch (view) {
      case 'pending':
        return isMyTaskActionable(task)
      case 'owned':
        return task.is_assignee
      case 'collaborating':
        return task.is_collaborator
      case 'review':
        return task.status === 'pending_review' && task.can_decide_review
      case 'completed':
        return task.status === 'completed'
    }
  })
}

const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3 } as const

function actionRank(task: MyTaskSummary): number {
  if (task.status === 'blocked' && hasExecutionResponsibility(task)) return 0
  if (task.status === 'pending_review' && task.can_decide_review) return 1
  if (task.status === 'todo' && hasExecutionResponsibility(task)) return 2
  if (task.status === 'in_progress' && hasExecutionResponsibility(task))
    return 3
  if (task.status === 'pending_review') return 4
  if (task.status === 'completed') return 5
  if (task.status === 'cancelled') return 6
  return 7
}

export function compareMyTasks(
  left: MyTaskSummary,
  right: MyTaskSummary,
): number {
  const actionDifference = actionRank(left) - actionRank(right)
  if (actionDifference !== 0) return actionDifference

  if (left.due_date !== right.due_date) {
    if (left.due_date === null) return 1
    if (right.due_date === null) return -1
    const dueDifference = left.due_date.localeCompare(right.due_date)
    if (dueDifference !== 0) return dueDifference
  }

  const priorityDifference =
    priorityRank[left.priority] - priorityRank[right.priority]
  if (priorityDifference !== 0) return priorityDifference

  const updatedDifference = right.updated_at.localeCompare(left.updated_at)
  if (updatedDifference !== 0) return updatedDifference
  return left.task_id.localeCompare(right.task_id)
}

export function sortMyTasks(tasks: MyTaskSummary[]): MyTaskSummary[] {
  return [...tasks].sort(compareMyTasks)
}
