import { describe, expect, it } from 'vitest'
import {
  archiveProject,
  createProject,
  getProject,
  listProjects,
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
    })
    const args = supabase.rpc.mock.calls[0][1]
    expect(args).not.toHaveProperty('created_by')
    expect(args).not.toHaveProperty('owner_id')
    expect(args).not.toHaveProperty('archived_at')
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
})
