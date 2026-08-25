import { describe, expect, it } from 'vitest'
import type { Project } from '@/features/projects'
import {
  buildManagementWorkbenchSnapshot,
  calculateManagementProjectHealth,
  calculateManagementProjectProgress,
  calendarDayDistance,
  isManagementTaskDueSoon,
  isManagementTaskOverdue,
  isManagementTaskStale,
  MANAGEMENT_TASK_LOAD_CONCURRENCY,
  mapWithConcurrency,
  selectManageableProjects,
  type ManagementProjectTaskLoad,
} from '@/features/management'
import type { TaskSummary } from '@/features/tasks'

const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001'
const CURRENT_USER_ID = '20000000-0000-4000-8000-000000000001'
const OTHER_USER_ID = '20000000-0000-4000-8000-000000000002'
const PROJECT_ID = '30000000-0000-4000-8000-000000000001'
const MODULE_ID = '40000000-0000-4000-8000-000000000001'
const TODAY = '2026-08-26'
const NOW = new Date('2026-08-26T12:00:00Z')

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    project_id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    name: '虚构管理项目',
    description: null,
    project_type: 'operations',
    status: 'active',
    owner_id: OTHER_USER_ID,
    owner_display_name: '虚构项目负责人',
    lead_id: null,
    lead_display_name: null,
    start_date: null,
    due_date: null,
    created_by: OTHER_USER_ID,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-25T00:00:00Z',
    archived_at: null,
    ...overrides,
  }
}

function makeTask(
  taskId: string,
  overrides: Partial<TaskSummary> = {},
): TaskSummary {
  return {
    task_id: taskId,
    project_id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    module_id: MODULE_ID,
    module_name: '虚构模块',
    title: `虚构任务 ${taskId.slice(-1)}`,
    assignee_id: OTHER_USER_ID,
    assignee_display_name: '虚构任务负责人',
    collaborators: [],
    priority: 'medium',
    start_date: null,
    due_date: null,
    estimated_hours: null,
    workload_level: 'm',
    visibility: 'project',
    status: 'todo',
    progress: 0,
    updated_at: '2026-08-25T12:00:00Z',
    ...overrides,
  }
}

function ready(tasks: TaskSummary[]): ManagementProjectTaskLoad {
  return { status: 'ready', tasks }
}

describe('管理者范围', () => {
  const ordinaryProject = makeProject()
  const ownedProject = makeProject({
    project_id: '30000000-0000-4000-8000-000000000002',
    owner_id: CURRENT_USER_ID,
  })
  const ledProject = makeProject({
    project_id: '30000000-0000-4000-8000-000000000003',
    lead_id: CURRENT_USER_ID,
    lead_display_name: '虚构当前用户',
  })
  const archivedProject = makeProject({
    project_id: '30000000-0000-4000-8000-000000000004',
    status: 'archived',
    archived_at: '2026-08-25T00:00:00Z',
  })
  const projects = [ordinaryProject, ownedProject, ledProject, archivedProject]

  it.each(['owner', 'admin'] as const)(
    'workspace %s 管理全部当前项目，但不纳入 archived',
    (role) => {
      expect(
        selectManageableProjects(projects, role, CURRENT_USER_ID).map(
          (project) => project.project_id,
        ),
      ).toEqual([
        ordinaryProject.project_id,
        ownedProject.project_id,
        ledProject.project_id,
      ])
    },
  )

  it('project owner 与 project lead 管理自己的项目', () => {
    expect(
      selectManageableProjects(projects, 'member', CURRENT_USER_ID).map(
        (project) => project.project_id,
      ),
    ).toEqual([ownedProject.project_id, ledProject.project_id])
  })

  it.each(['member', 'external_collaborator'] as const)(
    '%s 不会把普通可见项目误算为可管理项目',
    (role) => {
      expect(
        selectManageableProjects([ordinaryProject], role, CURRENT_USER_ID),
      ).toEqual([])
    },
  )
})

describe('项目健康度与任务异常', () => {
  it('completed 项目为 neutral', () => {
    expect(
      calculateManagementProjectHealth(
        makeProject({ status: 'completed' }),
        ready([]),
        TODAY,
        NOW,
      ),
    ).toBe('neutral')
  })

  it.each([
    [
      'blocked',
      makeTask('50000000-0000-4000-8000-000000000001', { status: 'blocked' }),
    ],
    [
      'overdue',
      makeTask('50000000-0000-4000-8000-000000000002', {
        due_date: '2026-08-25',
      }),
    ],
  ] as const)('%s 任务使项目成为 red', (_label, task) => {
    expect(
      calculateManagementProjectHealth(
        makeProject(),
        ready([task]),
        TODAY,
        NOW,
      ),
    ).toBe('red')
  })

  it('项目自身截止日期逾期使项目成为 red', () => {
    expect(
      calculateManagementProjectHealth(
        makeProject({ due_date: '2026-08-25' }),
        ready([]),
        TODAY,
        NOW,
      ),
    ).toBe('red')
  })

  it.each([
    ['paused', makeProject({ status: 'paused' }), []],
    [
      'pending_review',
      makeProject(),
      [
        makeTask('50000000-0000-4000-8000-000000000003', {
          status: 'pending_review',
        }),
      ],
    ],
    [
      'stale',
      makeProject(),
      [
        makeTask('50000000-0000-4000-8000-000000000004', {
          updated_at: '2026-08-19T12:00:00Z',
        }),
      ],
    ],
    [
      'due soon',
      makeProject(),
      [
        makeTask('50000000-0000-4000-8000-000000000005', {
          due_date: '2026-08-29',
        }),
      ],
    ],
  ] as const)('%s 至少使项目成为 yellow', (_label, project, tasks) => {
    expect(
      calculateManagementProjectHealth(project, ready([...tasks]), TODAY, NOW),
    ).toBe('yellow')
  })

  it('项目自身临近截止使项目成为 yellow', () => {
    expect(
      calculateManagementProjectHealth(
        makeProject({ due_date: '2026-08-29' }),
        ready([]),
        TODAY,
        NOW,
      ),
    ).toBe('yellow')
  })

  it('无异常项目为 green', () => {
    expect(
      calculateManagementProjectHealth(
        makeProject({ due_date: '2026-09-10' }),
        ready([
          makeTask('50000000-0000-4000-8000-000000000006', {
            due_date: '2026-09-10',
          }),
        ]),
        TODAY,
        NOW,
      ),
    ).toBe('green')
  })

  it('task load failure 为 unknown，绝不误判为 green', () => {
    expect(
      calculateManagementProjectHealth(
        makeProject(),
        { status: 'error', error: '虚构读取失败' },
        TODAY,
        NOW,
      ),
    ).toBe('unknown')
  })

  it.each(['completed', 'cancelled'] as const)(
    '%s 不算 overdue 或 stale',
    (status) => {
      const task = makeTask('50000000-0000-4000-8000-000000000007', {
        status,
        due_date: '2026-08-25',
        updated_at: '2020-01-01T00:00:00Z',
      })
      expect(isManagementTaskOverdue(task, TODAY)).toBe(false)
      expect(isManagementTaskStale(task, NOW)).toBe(false)
    },
  )
})

describe('日期与进度边界', () => {
  it('逾期按 date-only 本地业务日比较，今天不逾期、昨天逾期', () => {
    expect(
      isManagementTaskOverdue(
        makeTask('50000000-0000-4000-8000-000000000008', {
          due_date: TODAY,
        }),
        TODAY,
      ),
    ).toBe(false)
    expect(
      isManagementTaskOverdue(
        makeTask('50000000-0000-4000-8000-000000000009', {
          due_date: '2026-08-25',
        }),
        TODAY,
      ),
    ).toBe(true)
  })

  it('stale 在精确 7 天边界成立，少 1 毫秒不成立', () => {
    expect(
      isManagementTaskStale(
        makeTask('50000000-0000-4000-8000-000000000010', {
          updated_at: '2026-08-19T12:00:00Z',
        }),
        NOW,
      ),
    ).toBe(true)
    expect(
      isManagementTaskStale(
        makeTask('50000000-0000-4000-8000-000000000011', {
          updated_at: '2026-08-19T12:00:00.001Z',
        }),
        NOW,
      ),
    ).toBe(false)
  })

  it('due soon 包含今天和第 3 天，不包含第 4 天', () => {
    const task = makeTask('50000000-0000-4000-8000-000000000012')
    expect(isManagementTaskDueSoon({ ...task, due_date: TODAY }, TODAY)).toBe(
      true,
    )
    expect(
      isManagementTaskDueSoon({ ...task, due_date: '2026-08-29' }, TODAY),
    ).toBe(true)
    expect(
      isManagementTaskDueSoon({ ...task, due_date: '2026-08-30' }, TODAY),
    ).toBe(false)
  })

  it('date-only 跨月、闰日计算不依赖运行时区', () => {
    expect(calendarDayDistance('2024-02-28', '2024-03-01')).toBe(2)
    expect(calendarDayDistance('2025-02-28', '2025-03-01')).toBe(1)
    expect(calendarDayDistance('invalid', '2026-08-26')).toBeNull()
  })

  it('等价时区 timestamp 的 stale 结果一致', () => {
    const utc = makeTask('50000000-0000-4000-8000-000000000013', {
      updated_at: '2026-08-19T12:00:00Z',
    })
    const china = { ...utc, updated_at: '2026-08-19T20:00:00+08:00' }
    expect(isManagementTaskStale(utc, NOW)).toBe(true)
    expect(isManagementTaskStale(china, NOW)).toBe(true)
  })

  it('项目进度分母排除 cancelled，pending_review 不算完成，空任务为 0', () => {
    expect(
      calculateManagementProjectProgress([
        { status: 'completed' },
        { status: 'pending_review' },
        { status: 'cancelled' },
      ]),
    ).toBe(50)
    expect(calculateManagementProjectProgress([])).toBe(0)
    expect(calculateManagementProjectProgress([{ status: 'cancelled' }])).toBe(
      0,
    )
  })
})

describe('跨项目聚合', () => {
  it('跨项目读取遵守固定有界并发', async () => {
    let active = 0
    let maximumActive = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const operation = mapWithConcurrency(
      [1, 2, 3, 4, 5, 6],
      MANAGEMENT_TASK_LOAD_CONCURRENCY,
      async (value) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await gate
        active -= 1
        return value * 2
      },
    )

    await Promise.resolve()
    expect(maximumActive).toBe(MANAGEMENT_TASK_LOAD_CONCURRENCY)
    release?.()

    await expect(operation).resolves.toEqual([2, 4, 6, 8, 10, 12])
    expect(maximumActive).toBe(MANAGEMENT_TASK_LOAD_CONCURRENCY)
  })

  it('partial failure 保留成功项目、失败项目 unknown，并标记统计不完整', () => {
    const projectA = makeProject()
    const projectB = makeProject({
      project_id: '30000000-0000-4000-8000-000000000009',
      name: '虚构失败项目',
    })
    const task = makeTask('50000000-0000-4000-8000-000000000014', {
      status: 'blocked',
      due_date: '2026-08-25',
    })
    const snapshot = buildManagementWorkbenchSnapshot(
      [projectA, projectB],
      new Map([
        [projectA.project_id, ready([task])],
        [projectB.project_id, { status: 'error' as const, error: '虚构失败' }],
      ]),
      TODAY,
      NOW,
    )

    expect(snapshot.loadedProjectCount).toBe(1)
    expect(snapshot.totalProjectCount).toBe(2)
    expect(snapshot.hasPartialFailure).toBe(true)
    expect(snapshot.projects.map((item) => item.health)).toEqual([
      'red',
      'unknown',
    ])
    expect(snapshot.summary.overdueTasks).toBe(1)
    expect(snapshot.summary.blockedTasks).toBe(1)
    expect(snapshot.attentionItems).toHaveLength(1)
  })

  it('近期任务按 updated_at 降序且相同 task 不重复', () => {
    const project = makeProject()
    const older = makeTask('50000000-0000-4000-8000-000000000015', {
      updated_at: '2026-08-25T01:00:00Z',
    })
    const newer = makeTask('50000000-0000-4000-8000-000000000016', {
      updated_at: '2026-08-25T02:00:00Z',
    })
    const snapshot = buildManagementWorkbenchSnapshot(
      [project],
      new Map([[project.project_id, ready([older, newer, newer])]]),
      TODAY,
      NOW,
    )
    expect(snapshot.recentTasks.map((item) => item.task.task_id)).toEqual([
      newer.task_id,
      older.task_id,
    ])
  })

  it('近期任务按 timestamp instant 排序，而不是按带偏移量的字符串排序', () => {
    const project = makeProject()
    const earlier = makeTask('50000000-0000-4000-8000-000000000017', {
      updated_at: '2026-08-25T20:00:00+09:00',
    })
    const later = makeTask('50000000-0000-4000-8000-000000000018', {
      updated_at: '2026-08-25T12:30:00Z',
    })
    const snapshot = buildManagementWorkbenchSnapshot(
      [project],
      new Map([[project.project_id, ready([earlier, later])]]),
      TODAY,
      NOW,
    )

    expect(snapshot.recentTasks.map((item) => item.task.task_id)).toEqual([
      later.task_id,
      earlier.task_id,
    ])
  })
})
