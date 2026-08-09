import { describe, expect, it } from 'vitest'
import {
  createTask,
  getTask,
  listProjectTasks,
  listTaskAssignmentCandidates,
  updateTask,
} from '@/features/tasks/taskService'
import { mapTaskError } from '@/features/tasks/errors'
import {
  createSupabaseClientMock,
  FICTIONAL_APP_USER_ID,
  FICTIONAL_WORKSPACE_ID,
} from '@/tests/helpers/supabaseAuthMock'

const PROJECT_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const MODULE_ID = 'bbbbbbbb-1111-4111-8111-111111111111'
const TASK_ID = 'cccccccc-1111-4111-8111-111111111111'
const REVIEWER_ID = '22222222-2222-4222-8222-222222222222'

const taskRow = {
  task_id: TASK_ID,
  project_id: PROJECT_ID,
  workspace_id: FICTIONAL_WORKSPACE_ID,
  module_id: MODULE_ID,
  module_name: '虚构模块',
  title: '虚构任务',
  description: null,
  acceptance_criteria: '可复核的虚构标准',
  assignee_id: FICTIONAL_APP_USER_ID,
  assignee_display_name: '虚构负责人',
  collaborators: [],
  reviewer_id: REVIEWER_ID,
  reviewer_display_name: '虚构验收人',
  priority: 'medium' as const,
  start_date: '2026-08-09',
  due_date: '2026-08-10',
  estimated_hours: 4.5,
  workload_level: 'm' as const,
  visibility: 'project' as const,
  visibility_users: [],
  status: 'todo' as const,
  progress: 0,
  created_by: FICTIONAL_APP_USER_ID,
  created_at: '2026-08-09T01:00:00+00:00',
  updated_by: FICTIONAL_APP_USER_ID,
  updated_at: '2026-08-09T01:00:00+00:00',
}

const taskSummaryRow = {
  task_id: TASK_ID,
  project_id: PROJECT_ID,
  workspace_id: FICTIONAL_WORKSPACE_ID,
  module_id: MODULE_ID,
  module_name: '虚构模块',
  title: '虚构任务',
  assignee_id: FICTIONAL_APP_USER_ID,
  assignee_display_name: '虚构负责人',
  collaborators: [{ app_user_id: REVIEWER_ID, display_name: '虚构协作人' }],
  priority: 'high' as const,
  start_date: '2026-08-08',
  due_date: '2026-08-10',
  estimated_hours: 3.5,
  workload_level: 'm' as const,
  visibility: 'restricted' as const,
  status: 'blocked' as const,
  progress: 40,
  updated_at: '2026-08-09T02:00:00+00:00',
}

const createInput = {
  projectId: PROJECT_ID,
  moduleId: MODULE_ID,
  title: '虚构任务',
  description: '',
  acceptanceCriteria: '可复核的虚构标准',
  assigneeId: FICTIONAL_APP_USER_ID,
  collaboratorIds: [] as string[],
  reviewerId: REVIEWER_ID,
  priority: 'medium' as const,
  startDate: '2026-08-09',
  dueDate: '2026-08-10',
  estimatedHours: 4.5,
  workloadLevel: 'm' as const,
  visibility: 'project' as const,
  visibilityUserIds: [] as string[],
  idempotencyKey: 'dddddddd-1111-4111-8111-111111111111',
}

describe('任务 service', () => {
  it('列表只向 RPC 发送项目参数并接受合法 summary payload', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({ data: [taskSummaryRow], error: null })

    const result = await listProjectTasks(supabase.client, {
      projectId: PROJECT_ID,
      workspaceId: FICTIONAL_WORKSPACE_ID,
    })

    expect(result).toEqual({ ok: true, data: [taskSummaryRow] })
    expect(supabase.rpc).toHaveBeenCalledWith('list_project_tasks', {
      p_project_id: PROJECT_ID,
    })
  })

  it('空任务列表是合法成功', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({ data: [], error: null })

    await expect(
      listProjectTasks(supabase.client, {
        projectId: PROJECT_ID,
        workspaceId: FICTIONAL_WORKSPACE_ID,
      }),
    ).resolves.toEqual({ ok: true, data: [] })
  })

  it.each([
    ['非数组 payload', { malformed: true }],
    ['错误枚举', [{ ...taskSummaryRow, status: 'unknown' }]],
    ['错误日期', [{ ...taskSummaryRow, due_date: '2026-02-30' }]],
    ['错误时间戳', [{ ...taskSummaryRow, updated_at: 'yesterday' }]],
    [
      '重复协作人',
      [
        {
          ...taskSummaryRow,
          collaborators: [
            taskSummaryRow.collaborators[0],
            taskSummaryRow.collaborators[0],
          ],
        },
      ],
    ],
    ['畸形协作人数组', [{ ...taskSummaryRow, collaborators: 'hidden' }]],
    [
      '负责人重复为协作人',
      [
        {
          ...taskSummaryRow,
          collaborators: [
            {
              app_user_id: FICTIONAL_APP_USER_ID,
              display_name: '虚构负责人',
            },
          ],
        },
      ],
    ],
  ])('列表 RPC success 出现%s时 fail closed', async (_label, data) => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({ data, error: null })

    const result = await listProjectTasks(supabase.client, {
      projectId: PROJECT_ID,
      workspaceId: FICTIONAL_WORKSPACE_ID,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('unknown_service_error')
  })

  it.each([
    ['错误项目 scope', { ...taskSummaryRow, project_id: TASK_ID }],
    ['错误工作空间 scope', { ...taskSummaryRow, workspace_id: TASK_ID }],
  ])('列表拒绝%s', async (_label, row) => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({ data: [row], error: null })

    const result = await listProjectTasks(supabase.client, {
      projectId: PROJECT_ID,
      workspaceId: FICTIONAL_WORKSPACE_ID,
    })

    expect(result.ok).toBe(false)
  })

  it('列表拒绝重复 task ID', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: [taskSummaryRow, taskSummaryRow],
      error: null,
    })

    const result = await listProjectTasks(supabase.client, {
      projectId: PROJECT_ID,
      workspaceId: FICTIONAL_WORKSPACE_ID,
    })

    expect(result.ok).toBe(false)
  })

  it('列表忽略额外 detail 字段且前端结果不依赖私密字段', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: [
        {
          ...taskSummaryRow,
          description: '不应进入 summary',
          acceptance_criteria: '不应进入 summary',
          idempotency_key: 'eeeeeeee-1111-4111-8111-111111111111',
          visibility_users: [{ app_user_id: REVIEWER_ID }],
        },
      ],
      error: null,
    })

    const result = await listProjectTasks(supabase.client, {
      projectId: PROJECT_ID,
      workspaceId: FICTIONAL_WORKSPACE_ID,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data[0]).toEqual(taskSummaryRow)
    expect(result.data[0]).not.toHaveProperty('description')
    expect(result.data[0]).not.toHaveProperty('acceptance_criteria')
    expect(result.data[0]).not.toHaveProperty('idempotency_key')
    expect(result.data[0]).not.toHaveProperty('visibility_users')
  })

  it('列表数据库错误仅返回安全映射', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'task_not_found_or_forbidden' },
    })

    const result = await listProjectTasks(supabase.client, {
      projectId: PROJECT_ID,
      workspaceId: FICTIONAL_WORKSPACE_ID,
    })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'not_found_or_forbidden',
        message: '任务不存在或你无权访问。',
      },
    })
  })

  it('创建仅发送白名单字段，不发送 actor、status 或 progress', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: [{ ...taskRow, was_existing: false }],
      error: null,
    })

    const result = await createTask(supabase.client, createInput)

    expect(result).toEqual({ ok: true, data: taskRow })
    expect(supabase.rpc).toHaveBeenCalledWith('create_task', {
      p_project_id: PROJECT_ID,
      p_module_id: MODULE_ID,
      p_title: '虚构任务',
      p_description: null,
      p_acceptance_criteria: '可复核的虚构标准',
      p_assignee_id: FICTIONAL_APP_USER_ID,
      p_collaborator_ids: [],
      p_reviewer_id: REVIEWER_ID,
      p_priority: 'medium',
      p_start_date: '2026-08-09',
      p_due_date: '2026-08-10',
      p_estimated_hours: 4.5,
      p_workload_level: 'm',
      p_visibility: 'project',
      p_visibility_user_ids: [],
      p_idempotency_key: createInput.idempotencyKey,
    })
    const args = supabase.rpc.mock.calls[0][1]
    expect(args).not.toHaveProperty('actor_id')
    expect(args).not.toHaveProperty('status')
    expect(args).not.toHaveProperty('progress')
  })

  it('创建 RPC 缺少可信幂等结果标记时 fail closed', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({ data: [taskRow], error: null })

    const result = await createTask(supabase.client, createInput)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('unknown_service_error')
  })

  it('编辑发送 expected_updated_at 且没有幂等键或状态后门', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: [{ ...taskRow, title: '更新后的虚构任务' }],
      error: null,
    })

    const result = await updateTask(supabase.client, {
      ...createInput,
      title: '更新后的虚构任务',
      taskId: TASK_ID,
      expectedUpdatedAt: taskRow.updated_at,
    })

    expect(result.ok).toBe(true)
    const [name, args] = supabase.rpc.mock.calls[0]
    expect(name).toBe('update_task')
    expect(args).toMatchObject({
      p_task_id: TASK_ID,
      p_project_id: PROJECT_ID,
      p_expected_updated_at: taskRow.updated_at,
      p_title: '更新后的虚构任务',
    })
    expect(args).not.toHaveProperty('p_idempotency_key')
    expect(args).not.toHaveProperty('p_status')
    expect(args).not.toHaveProperty('p_progress')
  })

  it('空详情安全合并为不存在或无权访问', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({ data: [], error: null })

    const result = await getTask(supabase.client, TASK_ID)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('not_found_or_forbidden')
    expect(result.error.message).not.toContain(TASK_ID)
  })

  it('运行时校验接受合法的两位小数工时', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: [{ ...taskRow, estimated_hours: 0.29 }],
      error: null,
    })

    const result = await getTask(supabase.client, TASK_ID)

    expect(result.ok).toBe(true)
  })

  it.each([
    ['错误枚举', { ...taskRow, priority: 'critical' }],
    ['错误数值', { ...taskRow, progress: Number.NaN }],
    ['超出精度的预计工时', { ...taskRow, estimated_hours: 1.234 }],
    ['错误时间戳', { ...taskRow, updated_at: 'not-a-timestamp' }],
    ['不存在的日历日期', { ...taskRow, start_date: '2026-02-31' }],
    ['错误日期顺序', { ...taskRow, due_date: '2026-08-01' }],
    [
      '负责人重复为协作人',
      {
        ...taskRow,
        collaborators: [
          {
            app_user_id: FICTIONAL_APP_USER_ID,
            display_name: '虚构负责人',
          },
        ],
      },
    ],
    [
      '项目可见却返回显式名单',
      {
        ...taskRow,
        visibility_users: [
          { app_user_id: REVIEWER_ID, display_name: '虚构验收人' },
        ],
      },
    ],
  ])('RPC success payload 出现%s时 fail closed', async (_label, row) => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({ data: [row], error: null })

    const result = await getTask(supabase.client, TASK_ID)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('unknown_service_error')
  })

  it('任务 RPC 返回多行时 fail closed', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({ data: [taskRow, taskRow], error: null })

    const result = await getTask(supabase.client, TASK_ID)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('unknown_service_error')
  })

  it('候选人员校验 viewer 职责语义、项目作用域和重复项', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: [
        {
          project_id: PROJECT_ID,
          workspace_id: FICTIONAL_WORKSPACE_ID,
          app_user_id: FICTIONAL_APP_USER_ID,
          display_name: '虚构负责人',
          project_role: 'owner',
          can_hold_responsibility: true,
        },
        {
          project_id: PROJECT_ID,
          workspace_id: FICTIONAL_WORKSPACE_ID,
          app_user_id: REVIEWER_ID,
          display_name: '虚构只读成员',
          project_role: 'viewer',
          can_hold_responsibility: false,
        },
      ],
      error: null,
    })

    const valid = await listTaskAssignmentCandidates(
      supabase.client,
      PROJECT_ID,
    )
    expect(valid.ok).toBe(true)

    supabase.rpc.mockResolvedValue({
      data: [
        {
          project_id: PROJECT_ID,
          workspace_id: FICTIONAL_WORKSPACE_ID,
          app_user_id: REVIEWER_ID,
          display_name: '错误职责候选',
          project_role: 'viewer',
          can_hold_responsibility: true,
        },
      ],
      error: null,
    })
    const invalid = await listTaskAssignmentCandidates(
      supabase.client,
      PROJECT_ID,
    )
    expect(invalid.ok).toBe(false)

    supabase.rpc.mockResolvedValue({
      data: [
        {
          project_id: PROJECT_ID,
          workspace_id: FICTIONAL_WORKSPACE_ID,
          app_user_id: REVIEWER_ID,
          display_name: '   ',
          project_role: 'member',
          can_hold_responsibility: true,
        },
      ],
      error: null,
    })
    const emptyName = await listTaskAssignmentCandidates(
      supabase.client,
      PROJECT_ID,
    )
    expect(emptyName.ok).toBe(false)
  })

  it('数据库错误只映射稳定安全分类', () => {
    expect(
      mapTaskError({ code: '55000', message: 'task_project_archived' }),
    ).toEqual({
      code: 'project_archived',
      message: '已归档项目不能创建或编辑任务。',
    })
    expect(
      mapTaskError({ code: '40001', message: 'task_concurrent_update' }).code,
    ).toBe('concurrent_update')
    expect(mapTaskError({ message: 'relation tasks leaked detail' }).code).toBe(
      'unknown_service_error',
    )
  })
})
