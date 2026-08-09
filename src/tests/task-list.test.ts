import { describe, expect, it } from 'vitest'
import {
  emptyTaskListFilters,
  filterTaskSummaries,
  getLocalDateOnly,
  hasActiveTaskFilters,
  isTaskOverdue,
  parseTaskListState,
  sortTaskSummaries,
} from '@/features/tasks/taskList'
import type { TaskListFilters } from '@/features/tasks/taskList'
import type { TaskSummary } from '@/features/tasks'

const PROJECT_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const WORKSPACE_ID = '99999999-9999-4999-8999-999999999999'
const MODULE_A = 'bbbbbbbb-1111-4111-8111-111111111111'
const MODULE_B = 'bbbbbbbb-2222-4222-8222-222222222222'
const OWNER_ID = '11111111-1111-4111-8111-111111111111'
const MEMBER_ID = '22222222-2222-4222-8222-222222222222'

const baseTask: TaskSummary = {
  task_id: 'cccccccc-1111-4111-8111-111111111111',
  project_id: PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  module_id: MODULE_A,
  module_name: '虚构模块甲',
  title: '虚构任务甲',
  assignee_id: OWNER_ID,
  assignee_display_name: '虚构负责人',
  collaborators: [{ app_user_id: MEMBER_ID, display_name: '虚构协作人' }],
  priority: 'high',
  start_date: null,
  due_date: '2026-08-08',
  estimated_hours: null,
  workload_level: 'm',
  visibility: 'project',
  status: 'todo',
  progress: 0,
  updated_at: '2026-08-09T01:00:00+00:00',
}

describe('任务列表纯函数', () => {
  it.each([
    ['昨天 todo', '2026-08-08', 'todo', true],
    ['今天 todo', '2026-08-09', 'todo', false],
    ['明天 todo', '2026-08-10', 'todo', false],
    ['昨天 completed', '2026-08-08', 'completed', false],
    ['昨天 cancelled', '2026-08-08', 'cancelled', false],
    ['昨天 blocked', '2026-08-08', 'blocked', true],
    ['昨天 pending review', '2026-08-08', 'pending_review', true],
    ['无截止日期', null, 'todo', false],
  ] as const)('%s 的逾期语义正确', (_label, dueDate, status, expected) => {
    expect(isTaskOverdue({ due_date: dueDate, status }, '2026-08-09')).toBe(
      expected,
    )
  })

  it('本地日期由浏览器 calendar 字段生成而非 UTC 字符串截断', () => {
    expect(getLocalDateOnly(new Date(2026, 7, 9, 23, 30))).toBe('2026-08-09')
  })

  it('模块、负责人、协作人、状态、优先级和逾期可以组合筛选', () => {
    const matching = { ...baseTask, status: 'blocked' as const }
    const other: TaskSummary = {
      ...baseTask,
      task_id: 'cccccccc-2222-4222-8222-222222222222',
      module_id: MODULE_B,
      module_name: '虚构模块乙',
      assignee_id: MEMBER_ID,
      assignee_display_name: '虚构成员',
      collaborators: [],
      priority: 'low',
      status: 'completed',
    }
    const filters: TaskListFilters = {
      moduleId: MODULE_A,
      assigneeId: OWNER_ID,
      collaboratorId: MEMBER_ID,
      status: 'blocked',
      priority: 'high',
      overdue: true,
    }

    expect(
      filterTaskSummaries([other, matching], filters, '2026-08-09'),
    ).toEqual([matching])
  })

  it('清空筛选恢复全部任务，无结果组合返回空数组', () => {
    const tasks = [
      baseTask,
      {
        ...baseTask,
        task_id: 'cccccccc-2222-4222-8222-222222222222',
        status: 'completed' as const,
      },
    ]
    expect(hasActiveTaskFilters(emptyTaskListFilters)).toBe(false)
    expect(
      filterTaskSummaries(tasks, emptyTaskListFilters, '2026-08-09'),
    ).toHaveLength(2)
    expect(
      filterTaskSummaries(
        tasks,
        { ...emptyTaskListFilters, status: 'cancelled', priority: 'urgent' },
        '2026-08-09',
      ),
    ).toEqual([])
  })

  it('排序按逾期、截止日期、优先级、更新时间和 task id 稳定决胜', () => {
    const tasks: TaskSummary[] = [
      {
        ...baseTask,
        task_id: 'cccccccc-5000-4000-8000-000000000000',
        due_date: null,
        priority: 'urgent',
      },
      {
        ...baseTask,
        task_id: 'cccccccc-4000-4000-8000-000000000000',
        due_date: '2026-08-10',
        priority: 'low',
      },
      {
        ...baseTask,
        task_id: 'cccccccc-3000-4000-8000-000000000000',
        due_date: '2026-08-08',
        priority: 'low',
      },
      {
        ...baseTask,
        task_id: 'cccccccc-2000-4000-8000-000000000000',
        due_date: '2026-08-08',
        priority: 'urgent',
        updated_at: '2026-08-09T01:00:00+00:00',
      },
      {
        ...baseTask,
        task_id: 'cccccccc-1000-4000-8000-000000000000',
        due_date: '2026-08-08',
        priority: 'urgent',
        updated_at: '2026-08-09T01:00:00+00:00',
      },
    ]

    expect(
      sortTaskSummaries(tasks, '2026-08-09').map((task) => task.task_id),
    ).toEqual([
      'cccccccc-1000-4000-8000-000000000000',
      'cccccccc-2000-4000-8000-000000000000',
      'cccccccc-3000-4000-8000-000000000000',
      'cccccccc-4000-4000-8000-000000000000',
      'cccccccc-5000-4000-8000-000000000000',
    ])
  })

  it('URL query 只接受可信 option 和封闭枚举，非法值 fail safe', () => {
    const options = {
      moduleIds: new Set([MODULE_A]),
      assigneeIds: new Set([OWNER_ID]),
      collaboratorIds: new Set([MEMBER_ID]),
    }
    const valid = parseTaskListState(
      new URLSearchParams(
        `view=list&module=${MODULE_A}&assignee=${OWNER_ID}&collaborator=${MEMBER_ID}&status=blocked&priority=high&overdue=overdue`,
      ),
      options,
    )
    expect(valid).toEqual({
      view: 'list',
      filters: {
        moduleId: MODULE_A,
        assigneeId: OWNER_ID,
        collaboratorId: MEMBER_ID,
        status: 'blocked',
        priority: 'high',
        overdue: true,
      },
    })

    expect(
      parseTaskListState(
        new URLSearchParams(
          'view=drag&module=foreign&assignee=forged&collaborator=hidden&status=secret&priority=critical&overdue=false',
        ),
        options,
      ),
    ).toEqual({ view: 'board', filters: emptyTaskListFilters })
  })
})
