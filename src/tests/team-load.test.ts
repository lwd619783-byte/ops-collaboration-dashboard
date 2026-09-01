import { describe, expect, it } from 'vitest'
import {
  buildTeamLoadSnapshot,
  calculateKnownRemainingHours,
  isTeamLoadExecutionTask,
  sortTeamLoadMembers,
  type TeamLoadMember,
  type TeamLoadProjectBundleLoad,
} from '@/features/management'
import type { Project, ProjectMember } from '@/features/projects'
import type { TaskSummary } from '@/features/tasks'

const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001'
const PROJECT_A = '20000000-0000-4000-8000-000000000001'
const PROJECT_B = '20000000-0000-4000-8000-000000000002'
const MEMBER_A = '30000000-0000-4000-8000-000000000001'
const MEMBER_B = '30000000-0000-4000-8000-000000000002'
const MEMBER_C = '30000000-0000-4000-8000-000000000003'
const MODULE_ID = '40000000-0000-4000-8000-000000000001'
const TODAY = '2026-09-01'

function project(projectId: string, name: string): Project {
  return {
    project_id: projectId,
    workspace_id: WORKSPACE_ID,
    name,
    description: null,
    project_type: 'operations',
    status: 'active',
    owner_id: MEMBER_A,
    owner_display_name: '虚构负责人甲',
    lead_id: null,
    lead_display_name: null,
    start_date: null,
    due_date: null,
    created_by: MEMBER_A,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-31T00:00:00Z',
    archived_at: null,
  }
}

function member(
  projectId: string,
  appUserId: string,
  displayName: string,
  isActive = true,
): ProjectMember {
  return {
    project_id: projectId,
    workspace_id: WORKSPACE_ID,
    app_user_id: appUserId,
    display_name: displayName,
    project_role: 'member',
    workspace_role: 'member',
    joined_at: '2026-08-01T00:00:00Z',
    is_current_user: appUserId === MEMBER_A,
    is_active: isActive,
    active_member_count: isActive ? 1 : 0,
    inactive_historical_member_count: isActive ? 0 : 1,
  }
}

function task(
  taskId: string,
  projectId: string,
  assigneeId: string,
  overrides: Partial<TaskSummary> = {},
): TaskSummary {
  return {
    task_id: taskId,
    project_id: projectId,
    workspace_id: WORKSPACE_ID,
    module_id: MODULE_ID,
    module_name: '虚构模块',
    title: `虚构任务 ${taskId.slice(-1)}`,
    assignee_id: assigneeId,
    assignee_display_name: '虚构执行负责人',
    collaborators: [],
    priority: 'medium',
    start_date: null,
    due_date: null,
    estimated_hours: null,
    workload_level: 'm',
    visibility: 'project',
    status: 'todo',
    progress: 0,
    updated_at: '2026-08-31T12:00:00Z',
    ...overrides,
  }
}

function ready(
  members: ProjectMember[],
  tasks: TaskSummary[],
): TeamLoadProjectBundleLoad {
  return { status: 'ready', members, tasks }
}

describe('团队负荷执行口径', () => {
  it.each(['backlog', 'todo', 'in_progress', 'blocked'])(
    '%s 属于当前执行任务',
    (status) => {
      expect(isTeamLoadExecutionTask({ status })).toBe(true)
    },
  )

  it.each(['pending_review', 'completed', 'cancelled'])(
    '%s 不属于当前执行任务',
    (status) => {
      expect(isTeamLoadExecutionTask({ status })).toBe(false)
    },
  )

  it('剩余工时使用真实精度、clamp progress，缺失估算保持 unknown', () => {
    expect(
      calculateKnownRemainingHours({ estimated_hours: null, progress: 0 }),
    ).toBeNull()
    expect(
      calculateKnownRemainingHours({ estimated_hours: 10, progress: 0 }),
    ).toBe(10)
    expect(
      calculateKnownRemainingHours({ estimated_hours: 10, progress: 50 }),
    ).toBe(5)
    expect(
      calculateKnownRemainingHours({ estimated_hours: 10, progress: 100 }),
    ).toBe(0)
    expect(
      calculateKnownRemainingHours({ estimated_hours: 10, progress: -20 }),
    ).toBe(10)
    expect(
      calculateKnownRemainingHours({ estimated_hours: 10, progress: 120 }),
    ).toBe(0)
  })
})

describe('团队负荷跨项目聚合', () => {
  const projectA = project(PROJECT_A, '虚构项目甲')
  const projectB = project(PROJECT_B, '虚构项目乙')

  it('成员跨项目去重、保留 0 任务 active member、排除 inactive historical member', () => {
    const snapshot = buildTeamLoadSnapshot(
      [projectA, projectB],
      new Map([
        [
          PROJECT_A,
          ready(
            [
              member(PROJECT_A, MEMBER_A, '虚构成员甲'),
              member(PROJECT_A, MEMBER_B, '虚构历史成员', false),
            ],
            [task('50000000-0000-4000-8000-000000000001', PROJECT_A, MEMBER_A)],
          ),
        ],
        [
          PROJECT_B,
          ready(
            [
              member(PROJECT_B, MEMBER_A, '虚构成员甲'),
              member(PROJECT_B, MEMBER_C, '虚构成员丙'),
            ],
            [],
          ),
        ],
      ]),
      TODAY,
    )

    expect(snapshot.members).toHaveLength(2)
    expect(snapshot.summary.memberCount).toBe(2)
    expect(
      snapshot.members.find((item) => item.appUserId === MEMBER_A),
    ).toMatchObject({
      executionTaskCount: 1,
      projectIds: [PROJECT_A, PROJECT_B],
    })
    expect(
      snapshot.members.find((item) => item.appUserId === MEMBER_C),
    ).toMatchObject({
      executionTaskCount: 0,
      signal: 'clear',
    })
    expect(snapshot.members.some((item) => item.appUserId === MEMBER_B)).toBe(
      false,
    )
  })

  it('只按 assignee 计数，collaborator 不重复；待验收、完成和取消均排除', () => {
    const tasks = [
      task('50000000-0000-4000-8000-000000000002', PROJECT_A, MEMBER_A, {
        collaborators: [{ app_user_id: MEMBER_C, display_name: '虚构成员丙' }],
      }),
      task('50000000-0000-4000-8000-000000000003', PROJECT_A, MEMBER_A, {
        status: 'pending_review',
      }),
      task('50000000-0000-4000-8000-000000000004', PROJECT_A, MEMBER_A, {
        status: 'completed',
      }),
      task('50000000-0000-4000-8000-000000000005', PROJECT_A, MEMBER_A, {
        status: 'cancelled',
      }),
    ]
    const snapshot = buildTeamLoadSnapshot(
      [projectA],
      new Map([
        [
          PROJECT_A,
          ready(
            [
              member(PROJECT_A, MEMBER_A, '虚构成员甲'),
              member(PROJECT_A, MEMBER_C, '虚构成员丙'),
            ],
            tasks,
          ),
        ],
      ]),
      TODAY,
    )

    expect(snapshot.summary.executionTaskCount).toBe(1)
    expect(
      snapshot.members.find((item) => item.appUserId === MEMBER_A)
        ?.executionTaskCount,
    ).toBe(1)
    expect(
      snapshot.members.find((item) => item.appUserId === MEMBER_C)
        ?.executionTaskCount,
    ).toBe(0)
  })

  it('高优先级、阻塞、逾期、三天内到期与估算覆盖度正确', () => {
    const snapshot = buildTeamLoadSnapshot(
      [projectA],
      new Map([
        [
          PROJECT_A,
          ready(
            [member(PROJECT_A, MEMBER_A, '虚构成员甲')],
            [
              task(
                '50000000-0000-4000-8000-000000000006',
                PROJECT_A,
                MEMBER_A,
                {
                  priority: 'urgent',
                  status: 'blocked',
                  due_date: '2026-08-31',
                  estimated_hours: 10,
                  progress: 50,
                },
              ),
              task(
                '50000000-0000-4000-8000-000000000007',
                PROJECT_A,
                MEMBER_A,
                {
                  priority: 'high',
                  due_date: TODAY,
                  estimated_hours: null,
                },
              ),
              task(
                '50000000-0000-4000-8000-000000000008',
                PROJECT_A,
                MEMBER_A,
                {
                  due_date: '2026-09-04',
                  estimated_hours: 4,
                  progress: 25,
                },
              ),
              task(
                '50000000-0000-4000-8000-000000000009',
                PROJECT_A,
                MEMBER_A,
                {
                  due_date: '2026-09-05',
                },
              ),
            ],
          ),
        ],
      ]),
      TODAY,
    )
    expect(snapshot.members[0]).toMatchObject({
      executionTaskCount: 4,
      highPriorityCount: 2,
      blockedCount: 1,
      overdueCount: 1,
      dueSoonCount: 2,
      knownRemainingHours: 8,
      estimatedTaskCount: 2,
      signal: 'risk',
    })
    expect(snapshot.summary).toMatchObject({
      executionTaskCount: 4,
      knownRemainingHours: 8,
      estimatedTaskCount: 2,
    })
  })

  it('项目部分失败只聚合成功 bundle，全部失败保持 loaded 0 而非 false zero', () => {
    const partial = buildTeamLoadSnapshot(
      [projectA, projectB],
      new Map([
        [
          PROJECT_A,
          ready(
            [member(PROJECT_A, MEMBER_A, '虚构成员甲')],
            [task('50000000-0000-4000-8000-000000000010', PROJECT_A, MEMBER_A)],
          ),
        ],
        [PROJECT_B, { status: 'error' as const, error: '虚构失败' }],
      ]),
      TODAY,
    )
    expect(partial).toMatchObject({
      loadedProjectCount: 1,
      totalProjectCount: 2,
      hasPartialFailure: true,
    })
    expect(partial.summary.executionTaskCount).toBe(1)

    const failed = buildTeamLoadSnapshot(
      [projectA, projectB],
      new Map([
        [PROJECT_A, { status: 'error' as const, error: '虚构失败甲' }],
        [PROJECT_B, { status: 'error' as const, error: '虚构失败乙' }],
      ]),
      TODAY,
    )
    expect(failed.loadedProjectCount).toBe(0)
    expect(failed.totalProjectCount).toBe(2)
    expect(failed.hasPartialFailure).toBe(true)
  })

  it('默认排序按直接压力信号稳定排序，最终以名称和成员 ID 消歧', () => {
    const base: TeamLoadMember = {
      appUserId: MEMBER_A,
      displayName: '成员甲',
      projectIds: [PROJECT_A],
      projectNames: ['虚构项目甲'],
      executionTaskCount: 1,
      highPriorityCount: 0,
      blockedCount: 0,
      overdueCount: 0,
      dueSoonCount: 0,
      knownRemainingHours: 0,
      estimatedTaskCount: 0,
      signal: 'active',
    }
    const sorted = sortTeamLoadMembers([
      { ...base, appUserId: MEMBER_C, displayName: '成员丙', overdueCount: 1 },
      { ...base, appUserId: MEMBER_B, displayName: '成员乙', blockedCount: 1 },
      {
        ...base,
        appUserId: MEMBER_A,
        displayName: '成员甲',
        highPriorityCount: 1,
      },
    ])
    expect(sorted.map((item) => item.appUserId)).toEqual([
      MEMBER_B,
      MEMBER_C,
      MEMBER_A,
    ])
  })
})
