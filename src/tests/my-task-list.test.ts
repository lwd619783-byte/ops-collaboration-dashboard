import { describe, expect, it } from 'vitest'
import {
  filterMyTasks,
  isMyTaskActionable,
  sortMyTasks,
} from '@/features/tasks/myTaskList'
import type { MyTaskSummary } from '@/features/tasks'
import {
  FICTIONAL_APP_USER_ID,
  FICTIONAL_WORKSPACE_ID,
} from '@/tests/helpers/supabaseAuthMock'

const PROJECT_ID = 'a2000000-0000-4000-8000-000000000001'
const MODULE_ID = 'b2000000-0000-4000-8000-000000000001'
const OTHER_USER_ID = 'd2000000-0000-4000-8000-000000000001'

function makeTask(
  taskId: string,
  overrides: Partial<MyTaskSummary> = {},
): MyTaskSummary {
  return {
    task_id: taskId,
    workspace_id: FICTIONAL_WORKSPACE_ID,
    project_id: PROJECT_ID,
    project_name: '虚构排序项目',
    module_id: MODULE_ID,
    module_name: '虚构排序模块',
    title: `虚构任务 ${taskId.slice(-1)}`,
    status: 'todo',
    priority: 'medium',
    progress: 0,
    start_date: null,
    due_date: null,
    updated_at: '2026-08-24T01:00:00+00:00',
    assignee_id: FICTIONAL_APP_USER_ID,
    assignee_display_name: '虚构当前成员',
    reviewer_id: OTHER_USER_ID,
    reviewer_display_name: '虚构验收成员',
    collaborators: [],
    is_assignee: true,
    is_collaborator: false,
    is_reviewer: false,
    can_decide_review: false,
    ...overrides,
  }
}

describe('我的任务筛选与确定性排序', () => {
  const blocked = makeTask('c2000000-0000-4000-8000-000000000001', {
    title: '虚构阻塞任务',
    status: 'blocked',
    due_date: '2026-08-30',
  })
  const review = makeTask('c2000000-0000-4000-8000-000000000002', {
    title: '虚构待验收任务',
    status: 'pending_review',
    assignee_id: OTHER_USER_ID,
    is_assignee: false,
    can_decide_review: true,
    progress: 100,
    due_date: '2026-08-24',
  })
  const earlierDue = makeTask('c2000000-0000-4000-8000-000000000003', {
    title: '虚构较早到期任务',
    due_date: '2026-08-25',
    priority: 'low',
  })
  const urgentLater = makeTask('c2000000-0000-4000-8000-000000000004', {
    title: '虚构紧急较晚任务',
    due_date: '2026-08-26',
    priority: 'urgent',
  })
  const collaborating = makeTask('c2000000-0000-4000-8000-000000000005', {
    title: '虚构协作任务',
    assignee_id: OTHER_USER_ID,
    is_assignee: false,
    is_collaborator: true,
    collaborators: [
      { app_user_id: FICTIONAL_APP_USER_ID, display_name: '虚构当前成员' },
    ],
    status: 'in_progress',
  })
  const submitted = makeTask('c2000000-0000-4000-8000-000000000006', {
    title: '虚构已提交待他人验收任务',
    status: 'pending_review',
    progress: 100,
  })
  const completed = makeTask('c2000000-0000-4000-8000-000000000007', {
    title: '虚构已完成任务',
    status: 'completed',
    progress: 100,
  })

  it('按动作、截止日期、优先级、更新时间和 task_id 稳定排序', () => {
    expect(
      sortMyTasks([urgentLater, review, earlierDue, blocked]).map(
        (task) => task.task_id,
      ),
    ).toEqual([
      blocked.task_id,
      review.task_id,
      earlierDue.task_id,
      urgentLater.task_id,
    ])

    const tieA = makeTask('c2000000-0000-4000-8000-000000000008')
    const tieB = makeTask('c2000000-0000-4000-8000-000000000009')
    expect(sortMyTasks([tieB, tieA]).map((task) => task.task_id)).toEqual([
      tieA.task_id,
      tieB.task_id,
    ])
  })

  it('待处理不把无验收权的 pending_review 错当成当前动作', () => {
    expect(isMyTaskActionable(submitted)).toBe(false)
    expect(
      filterMyTasks(
        [blocked, review, earlierDue, collaborating, submitted],
        'pending',
      ).map((task) => task.task_id),
    ).toEqual([
      blocked.task_id,
      review.task_id,
      earlierDue.task_id,
      collaborating.task_id,
    ])
  })

  it('负责人、协作、验收和完成筛选保持独立语义', () => {
    const rows = [blocked, review, collaborating, submitted, completed]
    expect(filterMyTasks(rows, 'owned')).toEqual([
      blocked,
      submitted,
      completed,
    ])
    expect(filterMyTasks(rows, 'collaborating')).toEqual([collaborating])
    expect(filterMyTasks(rows, 'review')).toEqual([review])
    expect(filterMyTasks(rows, 'completed')).toEqual([completed])
  })
})
