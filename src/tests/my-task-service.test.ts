import { describe, expect, it } from 'vitest'
import { listMyTasks } from '@/features/tasks/taskService'
import {
  createSupabaseClientMock,
  FICTIONAL_APP_USER_ID,
  FICTIONAL_WORKSPACE_ID,
} from '@/tests/helpers/supabaseAuthMock'

const PROJECT_ID = 'a1000000-0000-4000-8000-000000000001'
const MODULE_ID = 'b1000000-0000-4000-8000-000000000001'
const TASK_ID = 'c1000000-0000-4000-8000-000000000001'
const REVIEWER_ID = 'd1000000-0000-4000-8000-000000000001'

const myTaskRow = {
  task_id: TASK_ID,
  workspace_id: FICTIONAL_WORKSPACE_ID,
  project_id: PROJECT_ID,
  project_name: '虚构跨项目工作台项目',
  module_id: MODULE_ID,
  module_name: '虚构执行模块',
  title: '虚构个人责任任务',
  status: 'todo' as const,
  priority: 'high' as const,
  progress: 20,
  start_date: '2026-08-20',
  due_date: '2026-08-28',
  updated_at: '2026-08-24T02:00:00+00:00',
  assignee_id: FICTIONAL_APP_USER_ID,
  assignee_display_name: '虚构当前成员',
  reviewer_id: REVIEWER_ID,
  reviewer_display_name: '虚构验收成员',
  collaborators: [],
  is_assignee: true,
  is_collaborator: false,
  is_reviewer: false,
  can_decide_review: false,
}

const input = {
  appUserId: FICTIONAL_APP_USER_ID,
  workspaceId: FICTIONAL_WORKSPACE_ID,
}

describe('我的任务 service', () => {
  it('只向 RPC 发送 workspace，并接受责任关系一致的 payload', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({ data: [myTaskRow], error: null })

    await expect(listMyTasks(supabase.client, input)).resolves.toEqual({
      ok: true,
      data: [myTaskRow],
    })
    expect(supabase.rpc).toHaveBeenCalledWith('list_my_tasks', {
      p_workspace_id: FICTIONAL_WORKSPACE_ID,
    })
  })

  it.each([
    [
      '错误 workspace',
      { ...myTaskRow, workspace_id: 'f1000000-0000-4000-8000-000000000001' },
    ],
    ['非法 UUID', { ...myTaskRow, task_id: 'not-a-uuid' }],
    ['错误负责人布尔值', { ...myTaskRow, is_assignee: false }],
    ['错误协作人布尔值', { ...myTaskRow, is_collaborator: true }],
    [
      '无责任关系的普通任务',
      {
        ...myTaskRow,
        assignee_id: REVIEWER_ID,
        is_assignee: false,
        can_decide_review: true,
      },
    ],
    ['非法日期顺序', { ...myTaskRow, due_date: '2026-08-19' }],
    ['非数组 payload', { malformed: true }],
  ])('%s 安全失败', async (label, payload) => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: label === '非数组 payload' ? payload : [payload],
      error: null,
    })

    const result = await listMyTasks(supabase.client, input)
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'unknown_service_error',
        message: '任务操作暂时无法完成，请稍后重试。',
      },
    })
  })

  it('拒绝重复 task_id', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: [myTaskRow, { ...myTaskRow }],
      error: null,
    })

    await expect(listMyTasks(supabase.client, input)).resolves.toMatchObject({
      ok: false,
      error: { code: 'unknown_service_error' },
    })
  })

  it('映射 RPC 权限错误且不暴露原始错误', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'task_permission_denied' },
    })

    await expect(listMyTasks(supabase.client, input)).resolves.toEqual({
      ok: false,
      error: {
        code: 'permission_denied',
        message: '你没有执行此任务操作的权限。',
      },
    })
  })
})
