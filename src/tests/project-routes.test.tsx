import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/AppRouter'
import {
  createSupabaseClientMock,
  FICTIONAL_APP_USER_ID,
  FICTIONAL_WORKSPACE_ID,
  fictionalWorkspace,
} from '@/tests/helpers/supabaseAuthMock'

const projectRow = {
  project_id: 'aaaaaaaa-1111-4111-8111-111111111111',
  workspace_id: FICTIONAL_WORKSPACE_ID,
  name: '路由虚构运维项目',
  description: '仅用于路由测试',
  project_type: 'operations',
  status: 'active',
  owner_id: FICTIONAL_APP_USER_ID,
  owner_display_name: '虚构负责人',
  lead_id: null,
  lead_display_name: null,
  start_date: null,
  due_date: null,
  created_by: FICTIONAL_APP_USER_ID,
  created_at: '2026-08-04T01:00:00+00:00',
  updated_at: '2026-08-04T02:00:00+00:00',
  archived_at: null,
}

function readyResolver(supabase: ReturnType<typeof createSupabaseClientMock>) {
  return () => ({ status: 'ready' as const, client: supabase.client })
}

describe('项目路由嵌套', () => {
  it('项目列表保持认证、工作空间和 AppLayout 门禁，并使用项目页标题', async () => {
    const supabase = createSupabaseClientMock({ hasSession: true })
    supabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'current_app_user_id') {
        return { data: FICTIONAL_APP_USER_ID, error: null }
      }
      if (name === 'list_my_workspaces') {
        return { data: [fictionalWorkspace], error: null }
      }
      if (name === 'list_my_pending_workspace_invitations') {
        return { data: [], error: null }
      }
      if (name === 'list_projects') {
        return { data: [projectRow], error: null }
      }
      return { data: null, error: null }
    })

    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppRouter resolveClient={readyResolver(supabase)} />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { level: 1, name: '项目' }),
    ).toBeInTheDocument()
    expect(await screen.findByText(projectRow.name)).toBeInTheDocument()
    expect(supabase.rpc).toHaveBeenCalledWith('list_projects', {
      p_workspace_id: FICTIONAL_WORKSPACE_ID,
      p_archived_only: false,
    })
  })

  it('普通成员手工打开创建路由时在 AppLayout 内被拒绝', async () => {
    const supabase = createSupabaseClientMock({
      hasSession: true,
      workspaceRows: [
        {
          ...fictionalWorkspace,
          role: 'member',
        },
      ],
    })

    render(
      <MemoryRouter initialEntries={['/projects/new']}>
        <AppRouter resolveClient={readyResolver(supabase)} />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { level: 2, name: '暂无访问权限' }),
    ).toBeInTheDocument()
    expect(
      supabase.rpc.mock.calls.some(([name]) => name === 'create_project'),
    ).toBe(false)
  })

  it('成员动态路由保持认证与工作空间门禁并加载安全成员投影', async () => {
    const supabase = createSupabaseClientMock({ hasSession: true })
    supabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'current_app_user_id') {
        return { data: FICTIONAL_APP_USER_ID, error: null }
      }
      if (name === 'list_my_workspaces') {
        return { data: [fictionalWorkspace], error: null }
      }
      if (name === 'list_my_pending_workspace_invitations') {
        return { data: [], error: null }
      }
      if (name === 'get_project') {
        return { data: [projectRow], error: null }
      }
      if (name === 'list_project_members') {
        return {
          data: [
            {
              project_id: projectRow.project_id,
              workspace_id: FICTIONAL_WORKSPACE_ID,
              app_user_id: FICTIONAL_APP_USER_ID,
              display_name: '虚构负责人',
              workspace_role: 'owner',
              project_role: 'owner',
              joined_at: projectRow.created_at,
              is_current_user: true,
              is_active: true,
              active_member_count: 1,
              inactive_historical_member_count: 0,
            },
          ],
          error: null,
        }
      }
      return { data: null, error: null }
    })

    render(
      <MemoryRouter
        initialEntries={[`/projects/${projectRow.project_id}/members`]}
      >
        <AppRouter resolveClient={readyResolver(supabase)} />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: projectRow.name }),
    ).toBeInTheDocument()
    expect(await screen.findByText('项目负责人')).toBeInTheDocument()
    expect(supabase.rpc).toHaveBeenCalledWith('list_project_members', {
      p_project_id: projectRow.project_id,
    })
  })

  it('未登录访问动态项目路径时安全回到登录页', async () => {
    const supabase = createSupabaseClientMock({ hasSession: false })

    render(
      <MemoryRouter
        initialEntries={['/projects/aaaaaaaa-1111-4111-8111-111111111111/edit']}
      >
        <AppRouter resolveClient={readyResolver(supabase)} />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { level: 2, name: '登录' }),
    ).toBeInTheDocument()
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'get_project',
      expect.anything(),
    )
  })
})
