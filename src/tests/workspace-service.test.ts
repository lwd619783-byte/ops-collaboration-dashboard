import { describe, expect, it } from 'vitest'
import {
  acceptWorkspaceInvitation,
  inviteWorkspaceMember,
  listWorkspaceMembers,
} from '@/features/workspaces/workspaceService'
import {
  createSupabaseClientMock,
  FICTIONAL_WORKSPACE_ID,
} from '@/tests/helpers/supabaseAuthMock'

describe('工作空间服务错误与幂等映射', () => {
  it('Edge Function 固定错误码映射为安全邀请错误，不透传响应内容', async () => {
    const supabase = createSupabaseClientMock()
    supabase.functionsInvoke.mockResolvedValue({
      data: null,
      error: {
        context: new Response(
          JSON.stringify({
            error: {
              code: 'invitation_conflict',
              message: 'raw provider detail must not be rendered',
            },
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 409 },
        ),
      },
    })

    const result = await inviteWorkspaceMember(supabase.client, {
      workspaceId: FICTIONAL_WORKSPACE_ID,
      email: 'invitee@example.invalid',
      displayName: 'Fictional Invitee',
      role: 'member',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invitation_conflict')
    expect(result.error.message).not.toContain('raw provider')
  })

  it('网络失败保持 network_unavailable，不误报为权限或账号停用', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'list_workspace_members') throw new Error('Failed to fetch')
      return { data: null, error: null }
    })

    const result = await listWorkspaceMembers(
      supabase.client,
      FICTIONAL_WORKSPACE_ID,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('network_unavailable')
  })

  it('接受 RPC 的 already_accepted 返回稳定幂等成功', async () => {
    const supabase = createSupabaseClientMock()
    supabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'accept_workspace_invitation') {
        return { data: [{ already_accepted: true }], error: null }
      }
      return { data: null, error: null }
    })

    const result = await acceptWorkspaceInvitation(
      supabase.client,
      '88888888-8888-4888-8888-888888888888',
    )

    expect(result).toEqual({ ok: true, data: { alreadyAccepted: true } })
  })
})
