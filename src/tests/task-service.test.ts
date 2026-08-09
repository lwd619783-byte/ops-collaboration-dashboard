import { describe, expect, it } from 'vitest'
import {
  blockTask,
  cancelTask,
  createTask,
  createTaskProgressUpdate,
  getTask,
  listProjectTasks,
  listTaskAssignmentCandidates,
  listTaskStatusHistory,
  listTaskUpdates,
  resumeTask,
  startTask,
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
const UPDATE_ID = 'eeeeeeee-3333-4333-8333-333333333333'

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
  last_progress_at: null,
  last_progress_by: null,
  last_progress_by_display_name: null,
  blocker_reason: null,
  blocked_at: null,
  blocked_by: null,
  blocked_by_display_name: null,
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

const progressRow = {
  update_id: UPDATE_ID,
  task_id: TASK_ID,
  sequence: 1,
  record_date: '2026-08-10',
  completed_content: 'Fictional completed work',
  progress: 40,
  issues: null,
  next_steps: 'Fictional next step',
  needs_assistance: true,
  is_blocked: false,
  block_transition_id: null,
  created_by: FICTIONAL_APP_USER_ID,
  created_by_display_name: '虚构负责人',
  created_at: '2026-08-10T02:00:00+00:00',
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
    const legacyCreatePayload: Record<string, unknown> = {
      ...taskRow,
      was_existing: false,
    }
    delete legacyCreatePayload.last_progress_at
    delete legacyCreatePayload.last_progress_by
    delete legacyCreatePayload.last_progress_by_display_name
    supabase.rpc
      .mockResolvedValueOnce({ data: [legacyCreatePayload], error: null })
      .mockResolvedValueOnce({ data: [taskRow], error: null })

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
    const legacyUpdatePayload: Record<string, unknown> = {
      ...taskRow,
      title: '更新后的虚构任务',
    }
    delete legacyUpdatePayload.last_progress_at
    delete legacyUpdatePayload.last_progress_by
    delete legacyUpdatePayload.last_progress_by_display_name
    supabase.rpc
      .mockResolvedValueOnce({ data: [legacyUpdatePayload], error: null })
      .mockResolvedValueOnce({
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

  it('start 只发送 task 和幂等键并校验受控 transition payload', async () => {
    const supabase = createSupabaseClientMock()
    const transitionedTask = {
      ...taskRow,
      status: 'in_progress' as const,
      updated_at: '2026-08-09T02:00:00+00:00',
    }
    supabase.rpc.mockResolvedValue({
      data: {
        task: transitionedTask,
        transition: {
          transition_id: 'eeeeeeee-1111-4111-8111-111111111111',
          task_id: TASK_ID,
          sequence: 1,
          from_status: 'todo',
          to_status: 'in_progress',
          action: 'start',
          created_at: '2026-08-09T02:00:00+00:00',
        },
        was_existing: false,
      },
      error: null,
    })

    const result = await startTask(supabase.client, {
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      workspaceId: FICTIONAL_WORKSPACE_ID,
      idempotencyKey: createInput.idempotencyKey,
    })

    expect(result.ok).toBe(true)
    expect(supabase.rpc).toHaveBeenCalledWith('start_task', {
      p_task_id: TASK_ID,
      p_idempotency_key: createInput.idempotencyKey,
    })
    expect(supabase.rpc.mock.calls[0][1]).not.toHaveProperty('actor_id')
    expect(supabase.rpc.mock.calls[0][1]).not.toHaveProperty('target_status')
  })

  it('block、resume、cancel 分别发送语义化 RPC 参数', async () => {
    const input = {
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      workspaceId: FICTIONAL_WORKSPACE_ID,
      idempotencyKey: createInput.idempotencyKey,
    }
    for (const [name, call, expectedArgs] of [
      [
        'block_task',
        (client: ReturnType<typeof createSupabaseClientMock>['client']) =>
          blockTask(client, {
            ...input,
            blockerReason: 'Fictional dependency',
          }),
        {
          p_task_id: TASK_ID,
          p_blocker_reason: 'Fictional dependency',
          p_idempotency_key: createInput.idempotencyKey,
        },
      ],
      [
        'resume_task',
        (client: ReturnType<typeof createSupabaseClientMock>['client']) =>
          resumeTask(client, input),
        {
          p_task_id: TASK_ID,
          p_idempotency_key: createInput.idempotencyKey,
        },
      ],
      [
        'cancel_task',
        (client: ReturnType<typeof createSupabaseClientMock>['client']) =>
          cancelTask(client, input),
        {
          p_task_id: TASK_ID,
          p_idempotency_key: createInput.idempotencyKey,
        },
      ],
    ] as const) {
      const supabase = createSupabaseClientMock()
      supabase.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
      await call(supabase.client)
      expect(supabase.rpc).toHaveBeenCalledWith(name, expectedArgs)
    }
  })

  it.each([
    [
      'impossible action/from/to',
      {
        task: { ...taskRow, status: 'blocked' },
        transition: {
          transition_id: 'eeeeeeee-1111-4111-8111-111111111111',
          task_id: TASK_ID,
          sequence: 1,
          from_status: 'todo',
          to_status: 'blocked',
          action: 'block',
          created_at: '2026-08-09T02:00:00+00:00',
        },
        was_existing: false,
      },
    ],
    [
      'wrong task scope',
      {
        task: { ...taskRow, project_id: TASK_ID },
        transition: {
          transition_id: 'eeeeeeee-1111-4111-8111-111111111111',
          task_id: TASK_ID,
          sequence: 1,
          from_status: 'todo',
          to_status: 'in_progress',
          action: 'start',
          created_at: '2026-08-09T02:00:00+00:00',
        },
        was_existing: true,
      },
    ],
    [
      'malformed sequence',
      {
        task: { ...taskRow, status: 'in_progress' },
        transition: {
          transition_id: 'eeeeeeee-1111-4111-8111-111111111111',
          task_id: TASK_ID,
          sequence: 0,
          from_status: 'todo',
          to_status: 'in_progress',
          action: 'start',
          created_at: '2026-08-09T02:00:00+00:00',
        },
        was_existing: false,
      },
    ],
  ])('transition success 的%s会 fail closed', async (_label, data) => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({ data, error: null })
    const result = await startTask(supabase.client, {
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      workspaceId: FICTIONAL_WORKSPACE_ID,
      idempotencyKey: createInput.idempotencyKey,
    })
    expect(result.ok).toBe(false)
  })

  it('history 按 sequence 校验完整状态链和阻塞原因', async () => {
    const supabase = createSupabaseClientMock()
    const history = [
      {
        transition_id: 'eeeeeeee-1111-4111-8111-111111111111',
        task_id: TASK_ID,
        sequence: 1,
        from_status: 'todo',
        to_status: 'in_progress',
        action: 'start',
        reason: null,
        actor_id: FICTIONAL_APP_USER_ID,
        actor_display_name: '虚构负责人',
        created_at: '2026-08-09T02:00:00+00:00',
      },
      {
        transition_id: 'eeeeeeee-2222-4222-8222-222222222222',
        task_id: TASK_ID,
        sequence: 2,
        from_status: 'in_progress',
        to_status: 'blocked',
        action: 'block',
        reason: 'Fictional dependency',
        actor_id: FICTIONAL_APP_USER_ID,
        actor_display_name: '虚构负责人',
        created_at: '2026-08-09T03:00:00+00:00',
      },
    ]
    supabase.rpc.mockResolvedValue({ data: history, error: null })

    await expect(
      listTaskStatusHistory(supabase.client, TASK_ID),
    ).resolves.toEqual({ ok: true, data: history })
    expect(supabase.rpc).toHaveBeenCalledWith('list_task_status_history', {
      p_task_id: TASK_ID,
    })

    supabase.rpc.mockResolvedValue({
      data: [{ ...history[0], sequence: 2 }],
      error: null,
    })
    const malformed = await listTaskStatusHistory(supabase.client, TASK_ID)
    expect(malformed.ok).toBe(false)
  })

  it('进展列表按 task scope 和连续 sequence 校验安全投影', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({ data: [progressRow], error: null })

    await expect(listTaskUpdates(supabase.client, TASK_ID)).resolves.toEqual({
      ok: true,
      data: [progressRow],
    })
    expect(supabase.rpc).toHaveBeenCalledWith('list_task_updates', {
      p_task_id: TASK_ID,
    })

    supabase.rpc.mockResolvedValue({
      data: [{ ...progressRow, sequence: 2 }],
      error: null,
    })
    expect((await listTaskUpdates(supabase.client, TASK_ID)).ok).toBe(false)
  })

  it('新增进展只发送白名单 payload 并严格校验 task/update 原子结果', async () => {
    const supabase = createSupabaseClientMock()
    const progressedTask = {
      ...taskRow,
      status: 'in_progress' as const,
      progress: 40,
      last_progress_at: progressRow.created_at,
      last_progress_by: FICTIONAL_APP_USER_ID,
      last_progress_by_display_name: '虚构负责人',
      updated_at: progressRow.created_at,
    }
    supabase.rpc.mockResolvedValue({
      data: {
        task: progressedTask,
        update: progressRow,
        was_existing: false,
      },
      error: null,
    })
    const input = {
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      workspaceId: FICTIONAL_WORKSPACE_ID,
      recordDate: '2026-08-10',
      completedContent: 'Fictional completed work',
      progress: 40,
      issues: '',
      nextSteps: 'Fictional next step',
      needsAssistance: true,
      markBlocked: false,
      blockerReason: '',
      idempotencyKey: createInput.idempotencyKey,
    }

    const result = await createTaskProgressUpdate(supabase.client, input)

    expect(result).toEqual({
      ok: true,
      data: {
        task: progressedTask,
        update: progressRow,
        was_existing: false,
      },
    })
    expect(supabase.rpc).toHaveBeenCalledWith('create_task_update', {
      p_task_id: TASK_ID,
      p_record_date: '2026-08-10',
      p_completed_content: 'Fictional completed work',
      p_progress: 40,
      p_issues: null,
      p_next_steps: 'Fictional next step',
      p_needs_assistance: true,
      p_mark_blocked: false,
      p_blocker_reason: null,
      p_idempotency_key: createInput.idempotencyKey,
    })
    expect(supabase.rpc.mock.calls[0][1]).not.toHaveProperty('actor_id')

    supabase.rpc.mockResolvedValue({
      data: {
        task: { ...progressedTask, last_progress_at: taskRow.created_at },
        update: progressRow,
        was_existing: false,
      },
      error: null,
    })
    expect((await createTaskProgressUpdate(supabase.client, input)).ok).toBe(
      false,
    )

    supabase.rpc.mockResolvedValue({
      data: {
        task: progressedTask,
        update: {
          ...progressRow,
          completed_content: 'Fictional unrelated replay',
        },
        was_existing: true,
      },
      error: null,
    })
    expect((await createTaskProgressUpdate(supabase.client, input)).ok).toBe(
      false,
    )
  })

  it('数据库错误只映射稳定安全分类', () => {
    expect(
      mapTaskError({ code: '55000', message: 'task_project_archived' }),
    ).toEqual({
      code: 'project_archived',
      message: '已归档项目不能变更任务。',
    })
    expect(
      mapTaskError({ code: '40001', message: 'task_concurrent_update' }).code,
    ).toBe('concurrent_update')
    expect(mapTaskError({ message: 'relation tasks leaked detail' }).code).toBe(
      'unknown_service_error',
    )
    expect(
      mapTaskError({
        code: '23505',
        message: 'task_transition_idempotency_conflict',
      }).code,
    ).toBe('transition_idempotency_conflict')
    expect(
      mapTaskError({
        code: '23505',
        message: 'task_update_idempotency_conflict',
      }).code,
    ).toBe('progress_idempotency_conflict')
  })
})
