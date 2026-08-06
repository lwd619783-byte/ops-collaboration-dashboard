import { describe, expect, it } from 'vitest'
import {
  addProjectMember,
  addProjectModule,
  archiveProject,
  clearProjectLead,
  createProject,
  deleteProjectModule,
  getProject,
  listProjectMemberCandidates,
  listProjectMembers,
  listProjectModules,
  listProjects,
  removeProjectMember,
  renameProjectModule,
  reorderProjectModules,
  setProjectLead,
  setProjectMemberRole,
  transferProjectOwner,
  updateProject,
} from '@/features/projects/projectService'
import {
  createSupabaseClientMock,
  FICTIONAL_WORKSPACE_ID,
} from '@/tests/helpers/supabaseAuthMock'

const projectRow = {
  project_id: 'aaaaaaaa-1111-4111-8111-111111111111',
  workspace_id: FICTIONAL_WORKSPACE_ID,
  name: '虚构运维项目',
  description: null,
  project_type: 'operations' as const,
  status: 'planning' as const,
  owner_id: '11111111-1111-4111-8111-111111111111',
  owner_display_name: '虚构负责人',
  lead_id: null,
  lead_display_name: null,
  start_date: null,
  due_date: null,
  created_by: '11111111-1111-4111-8111-111111111111',
  created_at: '2026-08-04T01:00:00+00:00',
  updated_at: '2026-08-04T01:00:00+00:00',
  archived_at: null,
}

const projectMemberRow = {
  project_id: projectRow.project_id,
  workspace_id: FICTIONAL_WORKSPACE_ID,
  app_user_id: projectRow.owner_id,
  display_name: projectRow.owner_display_name,
  workspace_role: 'owner' as const,
  project_role: 'owner' as const,
  joined_at: projectRow.created_at,
  is_current_user: true,
  is_active: true,
  active_member_count: 1,
  inactive_historical_member_count: 0,
}

const projectModuleRows = [
  {
    module_id: 'cccccccc-1111-4111-8111-111111111111',
    project_id: projectRow.project_id,
    name: '核心模块甲',
    sort_position: 0,
    created_by: projectRow.owner_id,
    updated_by: projectRow.owner_id,
    created_at: projectRow.created_at,
    updated_at: projectRow.updated_at,
  },
  {
    module_id: 'cccccccc-2222-4222-8222-222222222222',
    project_id: projectRow.project_id,
    name: '支撑模块乙',
    sort_position: 1,
    created_by: projectRow.owner_id,
    updated_by: projectRow.owner_id,
    created_at: projectRow.created_at,
    updated_at: projectRow.updated_at,
  },
]

describe('项目 service', () => {
  it('映射列表成功响应并只提交当前工作空间的受控筛选', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({ data: [projectRow], error: null })

    const result = await listProjects(supabase.client, {
      workspaceId: FICTIONAL_WORKSPACE_ID,
      archivedOnly: true,
      status: 'archived',
      search: ' 虚构项目 ',
    })

    expect(result).toEqual({ ok: true, data: [projectRow] })
    expect(supabase.rpc).toHaveBeenCalledWith('list_projects', {
      p_workspace_id: FICTIONAL_WORKSPACE_ID,
      p_archived_only: true,
      p_status: 'archived',
      p_search: '虚构项目',
    })
  })

  it('详情空响应统一映射为不存在或无权访问，不泄露 UUID 是否存在', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({ data: [], error: null })

    const result = await getProject(
      supabase.client,
      'aaaaaaaa-2222-4222-8222-222222222222',
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('not_found_or_forbidden')
    expect(result.error.message).not.toContain('aaaaaaaa')
  })

  it('创建参数不包含 actor、owner、成员或归档字段，并保留 date-only 值', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: [{ ...projectRow, was_existing: false }],
      error: null,
    })

    const result = await createProject(supabase.client, {
      workspaceId: FICTIONAL_WORKSPACE_ID,
      name: '虚构运维项目',
      description: '',
      projectType: 'operations',
      initialStatus: 'planning',
      startDate: '2026-08-04',
      dueDate: '2026-08-20',
      idempotencyKey: 'bbbbbbbb-1111-4111-8111-111111111111',
      initializeModules: false,
    })

    expect(result.ok).toBe(true)
    expect(supabase.rpc).toHaveBeenCalledWith('create_project', {
      p_workspace_id: FICTIONAL_WORKSPACE_ID,
      p_name: '虚构运维项目',
      p_description: null,
      p_project_type: 'operations',
      p_initial_status: 'planning',
      p_start_date: '2026-08-04',
      p_due_date: '2026-08-20',
      p_idempotency_key: 'bbbbbbbb-1111-4111-8111-111111111111',
      p_initialize_modules: false,
    })
    const args = supabase.rpc.mock.calls[0][1]
    expect(args).not.toHaveProperty('created_by')
    expect(args).not.toHaveProperty('owner_id')
    expect(args).not.toHaveProperty('archived_at')
  })

  it('成员和候选目录经过运行时角色与作用域校验', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc
      .mockResolvedValueOnce({ data: [projectMemberRow], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            project_id: projectRow.project_id,
            workspace_id: FICTIONAL_WORKSPACE_ID,
            app_user_id: '22222222-2222-4222-8222-222222222222',
            display_name: '虚构候选成员',
            workspace_role: 'member',
            existing_project_role: null,
          },
        ],
        error: null,
      })

    const members = await listProjectMembers(
      supabase.client,
      projectRow.project_id,
    )
    const candidates = await listProjectMemberCandidates(
      supabase.client,
      projectRow.project_id,
    )

    expect(members).toEqual({ ok: true, data: [projectMemberRow] })
    expect(candidates.ok).toBe(true)
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'list_project_members', {
      p_project_id: projectRow.project_id,
    })
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      2,
      'list_project_member_candidates',
      { p_project_id: projectRow.project_id },
    )
  })

  it('模块列表验证项目作用域、连续顺序和稳定字段', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({ data: projectModuleRows, error: null })

    const result = await listProjectModules(
      supabase.client,
      projectRow.project_id,
    )

    expect(result).toEqual({ ok: true, data: projectModuleRows })
    expect(supabase.rpc).toHaveBeenCalledWith('list_project_modules', {
      p_project_id: projectRow.project_id,
    })
  })

  it.each([
    [
      '跨项目响应',
      [
        {
          ...projectModuleRows[0],
          project_id: 'dddddddd-1111-4111-8111-111111111111',
        },
      ],
    ],
    ['顺序缺口', [{ ...projectModuleRows[0], sort_position: 1 }]],
    [
      '重复 ID',
      [
        projectModuleRows[0],
        { ...projectModuleRows[1], module_id: projectModuleRows[0].module_id },
      ],
    ],
    ['未规范名称', [{ ...projectModuleRows[0], name: ' 未规范 ' }]],
  ])('模块 RPC 返回%s时安全失败', async (_label, payload) => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({ data: payload, error: null })
    const result = await listProjectModules(
      supabase.client,
      projectRow.project_id,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('unknown_service_error')
  })

  it('模块写操作只提交项目、模块、规范名称或完整顺序', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({ data: projectModuleRows, error: null })

    const results = await Promise.all([
      addProjectModule(supabase.client, {
        projectId: projectRow.project_id,
        name: '  新增   模块 ',
      }),
      renameProjectModule(supabase.client, {
        projectId: projectRow.project_id,
        moduleId: projectModuleRows[0].module_id,
        name: '  改名   模块 ',
      }),
      reorderProjectModules(supabase.client, {
        projectId: projectRow.project_id,
        moduleIds: projectModuleRows.map((module) => module.module_id),
      }),
      deleteProjectModule(supabase.client, {
        projectId: projectRow.project_id,
        moduleId: projectModuleRows[1].module_id,
      }),
    ])

    expect(results.every((result) => result.ok)).toBe(true)
    expect(supabase.rpc.mock.calls).toEqual([
      [
        'add_project_module',
        { p_project_id: projectRow.project_id, p_name: '新增 模块' },
      ],
      [
        'rename_project_module',
        {
          p_project_id: projectRow.project_id,
          p_module_id: projectModuleRows[0].module_id,
          p_name: '改名 模块',
        },
      ],
      [
        'reorder_project_modules',
        {
          p_project_id: projectRow.project_id,
          p_module_ids: projectModuleRows.map((module) => module.module_id),
        },
      ],
      [
        'delete_project_module',
        {
          p_project_id: projectRow.project_id,
          p_module_id: projectModuleRows[1].module_id,
        },
      ],
    ])
  })

  it.each([
    ['22023', 'project_module_validation_failed', 'module_validation_failed'],
    ['23505', 'project_module_name_conflict', 'module_name_conflict'],
    ['22023', 'project_module_order_invalid', 'module_order_invalid'],
    [
      '42501',
      'project_module_not_found_or_forbidden',
      'module_not_found_or_forbidden',
    ],
    ['55000', 'project_module_not_empty', 'module_not_empty'],
    ['42501', 'project_module_permission_denied', 'permission_denied'],
  ] as const)(
    '真实数据库模块错误 %s / %s 映射为安全错误 %s',
    async (code, signal, expected) => {
      const supabase = createSupabaseClientMock()
      supabase.rpc.mockResolvedValue({
        data: null,
        error: {
          code,
          message: signal,
          details: 'internal relation public.project_modules must stay private',
          hint: null,
        },
      })
      const result = await addProjectModule(supabase.client, {
        projectId: projectRow.project_id,
        name: '虚构模块',
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe(expected)
      expect(result.error.message).not.toContain('public.')
      expect(result.error.code).not.toBe('network_unavailable')
      expect(result.error.code).not.toBe('unknown_service_error')
    },
  )

  it('无效枚举或缺失作用域字段的 RPC 载荷安全失败，不进入 UI', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: [{ ...projectMemberRow, project_role: 'database_drift' }],
      error: null,
    })
    const result = await listProjectMembers(
      supabase.client,
      projectRow.project_id,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('unknown_service_error')
  })

  it('六类成员写操作只提交受控参数并验证 changed 项目快照', async () => {
    const supabase = createSupabaseClientMock()
    const mutationRow = { ...projectRow, changed: true }
    supabase.rpc.mockResolvedValue({ data: [mutationRow], error: null })
    const userId = '22222222-2222-4222-8222-222222222222'

    const results = await Promise.all([
      addProjectMember(supabase.client, {
        projectId: projectRow.project_id,
        userId,
        role: 'member',
      }),
      setProjectMemberRole(supabase.client, {
        projectId: projectRow.project_id,
        userId,
        role: 'viewer',
      }),
      removeProjectMember(supabase.client, {
        projectId: projectRow.project_id,
        userId,
      }),
      setProjectLead(supabase.client, {
        projectId: projectRow.project_id,
        userId,
        expectedUpdatedAt: projectRow.updated_at,
      }),
      clearProjectLead(supabase.client, {
        projectId: projectRow.project_id,
        expectedUpdatedAt: projectRow.updated_at,
      }),
      transferProjectOwner(supabase.client, {
        projectId: projectRow.project_id,
        userId,
        expectedUpdatedAt: projectRow.updated_at,
      }),
    ])

    expect(results.every((result) => result.ok && result.data.changed)).toBe(
      true,
    )
    expect(supabase.rpc.mock.calls).toEqual([
      [
        'add_project_member',
        {
          p_project_id: projectRow.project_id,
          p_user_id: userId,
          p_role: 'member',
        },
      ],
      [
        'set_project_member_role',
        {
          p_project_id: projectRow.project_id,
          p_user_id: userId,
          p_role: 'viewer',
        },
      ],
      [
        'remove_project_member',
        { p_project_id: projectRow.project_id, p_user_id: userId },
      ],
      [
        'set_project_lead',
        {
          p_project_id: projectRow.project_id,
          p_user_id: userId,
          p_expected_updated_at: projectRow.updated_at,
        },
      ],
      [
        'clear_project_lead',
        {
          p_project_id: projectRow.project_id,
          p_expected_updated_at: projectRow.updated_at,
        },
      ],
      [
        'transfer_project_owner',
        {
          p_project_id: projectRow.project_id,
          p_user_id: userId,
          p_expected_updated_at: projectRow.updated_at,
        },
      ],
    ])
  })

  it.each([
    ['project_member_candidate_invalid', 'invalid_member_candidate'],
    ['project_member_role_conflict', 'member_role_conflict'],
    ['project_member_not_found', 'member_not_found'],
    ['project_member_role_protected', 'protected_member_role'],
    ['40001', 'concurrent_update'],
  ] as const)('成员业务错误 %s 映射为 %s', async (code, expected) => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code, message: code },
    })
    const result = await removeProjectMember(supabase.client, {
      projectId: projectRow.project_id,
      userId: projectRow.owner_id,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe(expected)
    expect(result.error.message).not.toContain('public.')
  })

  it.each([
    ['project_validation_failed', 'validation_failed'],
    ['project_invalid_transition', 'invalid_transition'],
    ['project_concurrent_update', 'concurrent_update'],
    ['project_idempotency_conflict', 'duplicate_submission'],
    ['project_archived', 'project_archived'],
  ] as const)(
    '数据库错误 %s 映射为安全错误 %s',
    async (databaseCode, safeCode) => {
      const supabase = createSupabaseClientMock()
      supabase.rpc.mockResolvedValue({
        data: null,
        error: {
          message: databaseCode,
          details: 'sensitive constraint detail must not reach UI',
        },
      })

      const result = await updateProject(supabase.client, {
        projectId: projectRow.project_id,
        name: projectRow.name,
        description: '',
        status: 'planning',
        startDate: null,
        dueDate: null,
        expectedUpdatedAt: projectRow.updated_at,
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe(safeCode)
      expect(result.error.message).not.toContain('constraint')
    },
  )

  it('网络失败与未知 PostgreSQL 细节均不直接透传', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockRejectedValueOnce(new Error('Failed to fetch'))
    const network = await archiveProject(
      supabase.client,
      projectRow.project_id,
      projectRow.updated_at,
    )
    expect(network.ok).toBe(false)
    if (network.ok) return
    expect(network.error.code).toBe('network_unavailable')

    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'relation public.projects leaked raw detail' },
    })
    const unknown = await getProject(supabase.client, projectRow.project_id)
    expect(unknown.ok).toBe(false)
    if (unknown.ok) return
    expect(unknown.error.code).toBe('unknown_service_error')
    expect(unknown.error.message).not.toContain('public.projects')
  })

  it('jwt_expired code maps to authentication_required even when message is also present', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: 'jwt_expired', message: 'JWT expired' },
    })
    const result = await getProject(supabase.client, projectRow.project_id)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('authentication_required')
  })

  it('code and message both present for a business error map by code, not message', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'project_concurrent_update',
        message: '项目已被其他人修改，请刷新后重试。',
      },
    })
    const result = await updateProject(supabase.client, {
      projectId: projectRow.project_id,
      name: projectRow.name,
      description: '',
      status: 'planning',
      startDate: null,
      dueDate: null,
      expectedUpdatedAt: projectRow.updated_at,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('concurrent_update')
  })

  it('message-only JWT expiry still maps to authentication_required', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'received jwt expired from postgrest' },
    })
    const result = await getProject(supabase.client, projectRow.project_id)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('authentication_required')
  })

  it('ordinary permission denial is mapped to permission_denied, not a login failure', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    })
    const result = await getProject(supabase.client, projectRow.project_id)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('permission_denied')
  })

  describe('认证与权限错误代码映射强化', () => {
    it.each([
      ['PGRST301', 'JWT expired'],
      ['PGRST302', 'Anonymous access is disabled'],
      ['PGRST303', 'JWT claims validation failed'],
    ] as const)(
      'PostgREST 认证代码 %s 映射为 authentication_required',
      async (code, message) => {
        const supabase = createSupabaseClientMock()
        supabase.rpc.mockResolvedValue({
          data: null,
          error: { code, message },
        })
        const result = await getProject(supabase.client, projectRow.project_id)
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error.code).toBe('authentication_required')
      },
    )

    it('SQLSTATE 42501 映射为 permission_denied', async () => {
      const supabase = createSupabaseClientMock()
      supabase.rpc.mockResolvedValue({
        data: null,
        error: {
          code: '42501',
          message: 'permission denied for function get_project',
        },
      })
      const result = await getProject(supabase.client, projectRow.project_id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('permission_denied')
    })

    it('业务错误代码优先于 message 中的 token 措辞', async () => {
      const supabase = createSupabaseClientMock()
      supabase.rpc.mockResolvedValue({
        data: null,
        error: {
          code: 'project_concurrent_update',
          message: 'token wording must not override business code',
        },
      })
      const result = await updateProject(supabase.client, {
        projectId: projectRow.project_id,
        name: projectRow.name,
        description: '',
        status: 'planning',
        startDate: null,
        dueDate: null,
        expectedUpdatedAt: projectRow.updated_at,
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('concurrent_update')
    })

    it('message 中出现偶然的 token 单词不映射为 authentication_required', async () => {
      const supabase = createSupabaseClientMock()
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'project token quota is temporarily unavailable' },
      })
      const result = await getProject(supabase.client, projectRow.project_id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).not.toBe('authentication_required')
    })
  })

  describe('成员计数契约校验', () => {
    function memberRow(overrides: Record<string, unknown> = {}) {
      return {
        project_id: projectRow.project_id,
        workspace_id: FICTIONAL_WORKSPACE_ID,
        app_user_id: 'bbbbbbbb-1111-4111-8111-111111111111',
        display_name: '虚构成员',
        workspace_role: 'member' as const,
        project_role: 'member' as const,
        joined_at: projectRow.created_at,
        is_current_user: false,
        is_active: true,
        active_member_count: 1,
        inactive_historical_member_count: 0,
        ...overrides,
      }
    }

    it('合法单条成员数据通过校验', async () => {
      const supabase = createSupabaseClientMock()
      supabase.rpc.mockResolvedValue({
        data: [memberRow()],
        error: null,
      })
      const result = await listProjectMembers(
        supabase.client,
        projectRow.project_id,
      )
      expect(result).toEqual({ ok: true, data: [memberRow()] })
    })

    it('合法混合 active/inactive 数据通过校验', async () => {
      const active = memberRow({
        app_user_id: 'bbbbbbbb-1111-4111-8111-111111111111',
        is_active: true,
        active_member_count: 1,
        inactive_historical_member_count: 2,
      })
      const inactive = memberRow({
        app_user_id: 'cccccccc-1111-4111-8111-111111111111',
        is_active: false,
        active_member_count: 1,
        inactive_historical_member_count: 2,
      })
      const inactive2 = memberRow({
        app_user_id: 'dddddddd-1111-4111-8111-111111111111',
        is_active: false,
        active_member_count: 1,
        inactive_historical_member_count: 2,
      })
      const supabase = createSupabaseClientMock()
      supabase.rpc.mockResolvedValue({
        data: [active, inactive, inactive2],
        error: null,
      })
      const result = await listProjectMembers(
        supabase.client,
        projectRow.project_id,
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data).toHaveLength(3)
    })

    it('空数组合法返回空数组', async () => {
      const supabase = createSupabaseClientMock()
      supabase.rpc.mockResolvedValue({ data: [], error: null })
      const result = await listProjectMembers(
        supabase.client,
        projectRow.project_id,
      )
      expect(result).toEqual({ ok: true, data: [] })
    })

    it('负计数安全失败', async () => {
      const supabase = createSupabaseClientMock()
      supabase.rpc.mockResolvedValue({
        data: [
          memberRow({
            active_member_count: -1,
            inactive_historical_member_count: 0,
          }),
        ],
        error: null,
      })
      const result = await listProjectMembers(
        supabase.client,
        projectRow.project_id,
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('unknown_service_error')
    })

    it('小数计数安全失败', async () => {
      const supabase = createSupabaseClientMock()
      supabase.rpc.mockResolvedValue({
        data: [
          memberRow({
            active_member_count: 1.5,
            inactive_historical_member_count: 0,
          }),
        ],
        error: null,
      })
      const result = await listProjectMembers(
        supabase.client,
        projectRow.project_id,
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('unknown_service_error')
    })

    it('NaN/Infinity 计数安全失败', async () => {
      const supabase = createSupabaseClientMock()
      supabase.rpc.mockResolvedValue({
        data: [
          memberRow({
            active_member_count: Number.NaN,
            inactive_historical_member_count: 0,
          }),
        ],
        error: null,
      })
      const result = await listProjectMembers(
        supabase.client,
        projectRow.project_id,
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('unknown_service_error')
    })

    it('不同成员行计数不一致安全失败', async () => {
      const first = memberRow({
        app_user_id: 'bbbbbbbb-1111-4111-8111-111111111111',
        active_member_count: 2,
        inactive_historical_member_count: 0,
      })
      const second = memberRow({
        app_user_id: 'cccccccc-1111-4111-8111-111111111111',
        active_member_count: 3,
        inactive_historical_member_count: 0,
      })
      const supabase = createSupabaseClientMock()
      supabase.rpc.mockResolvedValue({ data: [first, second], error: null })
      const result = await listProjectMembers(
        supabase.client,
        projectRow.project_id,
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('unknown_service_error')
    })

    it('计数之和不等于行数安全失败', async () => {
      const first = memberRow({
        app_user_id: 'bbbbbbbb-1111-4111-8111-111111111111',
        is_active: true,
        active_member_count: 5,
        inactive_historical_member_count: 5,
      })
      const supabase = createSupabaseClientMock()
      supabase.rpc.mockResolvedValue({ data: [first], error: null })
      const result = await listProjectMembers(
        supabase.client,
        projectRow.project_id,
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('unknown_service_error')
    })

    it('计数与 is_active 标记不一致安全失败', async () => {
      // Both rows are active, so actualActive = 2, but the header counts claim
      // only one active and one inactive member: the counts disagree with the
      // per-row is_active flags and must be rejected.
      const first = memberRow({
        app_user_id: 'bbbbbbbb-1111-4111-8111-111111111111',
        is_active: true,
        active_member_count: 1,
        inactive_historical_member_count: 1,
      })
      const second = memberRow({
        app_user_id: 'cccccccc-1111-4111-8111-111111111111',
        is_active: true,
        active_member_count: 1,
        inactive_historical_member_count: 1,
      })
      const supabase = createSupabaseClientMock()
      supabase.rpc.mockResolvedValue({ data: [first, second], error: null })
      const result = await listProjectMembers(
        supabase.client,
        projectRow.project_id,
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('unknown_service_error')
    })
  })
})
