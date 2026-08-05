import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import {
  ProjectContext,
  type ProjectContextValue,
} from '@/features/projects/ProjectContext'
import type {
  Project,
  ProjectMember,
  ProjectMemberCandidate,
  ProjectRole,
} from '@/features/projects/types'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/workspaces/WorkspaceContext'
import type { WorkspaceRole } from '@/features/workspaces/types'
import { ProjectMembersPage } from '@/pages/ProjectMembersPage'
import {
  FICTIONAL_APP_USER_ID,
  FICTIONAL_WORKSPACE_ID,
} from '@/tests/helpers/supabaseAuthMock'

const PROJECT_ID = 'aaaaaaaa-3333-4333-8333-333333333333'
const OWNER_ID = '22222222-2222-4222-8222-222222222222'
const CANDIDATE_ID = '33333333-3333-4333-8333-333333333333'

const project: Project = {
  project_id: PROJECT_ID,
  workspace_id: FICTIONAL_WORKSPACE_ID,
  name: '虚构成员管理项目',
  description: null,
  project_type: 'operations',
  status: 'active',
  owner_id: OWNER_ID,
  owner_display_name: '虚构项目负责人',
  lead_id: null,
  lead_display_name: null,
  start_date: null,
  due_date: null,
  created_by: OWNER_ID,
  created_at: '2026-08-05T01:00:00+00:00',
  updated_at: '2026-08-05T02:00:00.123456+00:00',
  archived_at: null,
}

function member(
  appUserId: string,
  projectRole: ProjectRole,
  current = false,
  options: {
    isActive?: boolean
    activeMemberCount?: number
    inactiveHistoricalMemberCount?: number
  } = {},
): ProjectMember {
  const {
    isActive = true,
    activeMemberCount = 1,
    inactiveHistoricalMemberCount = 0,
  } = options
  return {
    project_id: PROJECT_ID,
    workspace_id: FICTIONAL_WORKSPACE_ID,
    app_user_id: appUserId,
    display_name: appUserId === OWNER_ID ? '虚构项目负责人' : '虚构当前成员',
    workspace_role: 'member',
    project_role: projectRole,
    joined_at: '2026-08-05T01:00:00+00:00',
    is_current_user: current,
    is_active: isActive,
    active_member_count: activeMemberCount,
    inactive_historical_member_count: inactiveHistoricalMemberCount,
  }
}

const candidate: ProjectMemberCandidate = {
  project_id: PROJECT_ID,
  workspace_id: FICTIONAL_WORKSPACE_ID,
  app_user_id: CANDIDATE_ID,
  display_name: '虚构候选成员',
  workspace_role: 'member',
  existing_project_role: null,
}

function workspaceValue(role: WorkspaceRole): WorkspaceContextValue {
  return {
    status: 'ready',
    workspaces: [],
    currentWorkspace: {
      workspace_id: FICTIONAL_WORKSPACE_ID,
      workspace_name: '虚构工作空间',
      role,
      status: 'active',
      joined_at: '2026-08-01T00:00:00+00:00',
    },
    pendingInvitations: [],
    error: null,
    refresh: vi.fn(async () => undefined),
    listMembers: vi.fn(async () => ({ ok: true as const, data: [] })),
    inviteMember: vi.fn(async () => ({ ok: true as const, data: undefined })),
    setMemberRole: vi.fn(async () => ({ ok: true as const, data: undefined })),
    setMemberStatus: vi.fn(async () => ({
      ok: true as const,
      data: undefined,
    })),
    acceptInvitation: vi.fn(async () => ({
      ok: true as const,
      data: { alreadyAccepted: false },
    })),
  }
}

function projectValue(
  actorRole: ProjectRole,
  overrides: Partial<ProjectContextValue> = {},
): ProjectContextValue {
  const currentProject =
    actorRole === 'owner'
      ? {
          ...project,
          owner_id: FICTIONAL_APP_USER_ID,
          owner_display_name: '虚构当前成员',
        }
      : project
  const members =
    actorRole === 'owner'
      ? [member(FICTIONAL_APP_USER_ID, 'owner', true)]
      : [
          member(OWNER_ID, 'owner'),
          member(FICTIONAL_APP_USER_ID, actorRole, true),
        ]
  const mutation = { ...currentProject, changed: true }
  return {
    list: vi.fn(async () => ({ ok: true as const, data: [currentProject] })),
    get: vi.fn(async () => ({ ok: true as const, data: currentProject })),
    create: vi.fn(async () => ({ ok: true as const, data: currentProject })),
    update: vi.fn(async () => ({ ok: true as const, data: currentProject })),
    archive: vi.fn(async () => ({ ok: true as const, data: currentProject })),
    listMembers: vi.fn(async () => ({ ok: true as const, data: members })),
    listMemberCandidates: vi.fn(async () => ({
      ok: true as const,
      data: [candidate],
    })),
    addMember: vi.fn(async () => ({ ok: true as const, data: mutation })),
    setMemberRole: vi.fn(async () => ({
      ok: true as const,
      data: mutation,
    })),
    removeMember: vi.fn(async () => ({ ok: true as const, data: mutation })),
    setLead: vi.fn(async () => ({ ok: true as const, data: mutation })),
    clearLead: vi.fn(async () => ({ ok: true as const, data: mutation })),
    transferOwner: vi.fn(async () => ({
      ok: true as const,
      data: mutation,
    })),
    ...overrides,
  }
}

function renderPage(
  actorRole: ProjectRole,
  workspaceRole: WorkspaceRole = 'member',
  value: ProjectContextValue = projectValue(actorRole),
) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/members`]}>
      <WorkspaceContext.Provider value={workspaceValue(workspaceRole)}>
        <ProjectContext.Provider value={value}>
          <Routes>
            <Route
              path="/projects/:projectId/members"
              element={<ProjectMembersPage />}
            />
          </Routes>
        </ProjectContext.Provider>
      </WorkspaceContext.Provider>
    </MemoryRouter>,
  )
}

describe('项目成员页', () => {
  it('viewer 清晰看到负责人和自身角色，但没有任何写入口', async () => {
    renderPage('viewer')
    expect(
      await screen.findByRole('heading', { name: project.name }),
    ).toBeInTheDocument()
    expect(screen.getByText('项目负责人')).toBeInTheDocument()
    expect(screen.getByText('只读成员')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '添加成员' })).toBeNull()
    expect(screen.queryByRole('button', { name: '调整角色' })).toBeNull()
    expect(screen.queryByRole('button', { name: '转让负责人' })).toBeNull()
  })

  it('project lead 只显示普通成员管理，不显示负责人或牵头人专用操作', async () => {
    const value = projectValue('lead', {
      listMembers: vi.fn(async () => ({
        ok: true as const,
        data: [
          member(OWNER_ID, 'owner'),
          member(FICTIONAL_APP_USER_ID, 'lead', true),
          member(CANDIDATE_ID, 'member'),
        ],
      })),
    })
    renderPage('lead', 'member', value)
    expect(
      await screen.findByRole('button', { name: '添加成员' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '调整角色' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移除成员' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '任命牵头人' })).toBeNull()
    expect(screen.queryByRole('button', { name: '转让负责人' })).toBeNull()
  })

  it('添加成员对话框只展示候选人，提交普通角色和实体作用域', async () => {
    const user = userEvent.setup()
    const value = projectValue('owner')
    renderPage('owner', 'member', value)

    await user.click(await screen.findByRole('button', { name: '添加成员' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/选择用户/)).toBeEnabled(),
    )
    await user.selectOptions(
      within(dialog).getByLabelText(/选择用户/),
      CANDIDATE_ID,
    )
    await user.selectOptions(
      within(dialog).getByLabelText('项目角色'),
      'viewer',
    )
    await user.click(within(dialog).getByRole('button', { name: '确认添加' }))

    await waitFor(() =>
      expect(value.addMember).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        userId: CANDIDATE_ID,
        role: 'viewer',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      '项目成员已添加',
    )
  })

  it('项目 owner 通过明确确认对话框任命 lead，并携带高精度 updated_at', async () => {
    const user = userEvent.setup()
    const value = projectValue('owner')
    renderPage('owner', 'member', value)

    await user.click(await screen.findByRole('button', { name: '任命牵头人' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/选择用户/)).toBeEnabled(),
    )
    await user.selectOptions(
      within(dialog).getByLabelText(/选择用户/),
      CANDIDATE_ID,
    )
    await user.click(within(dialog).getByRole('button', { name: '确认任命' }))

    await waitFor(() =>
      expect(value.setLead).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        userId: CANDIDATE_ID,
        expectedUpdatedAt: project.updated_at,
      }),
    )
  })

  it('workspace admin 可以转让负责人，普通项目 member 不可以', async () => {
    const user = userEvent.setup()
    const adminValue = projectValue('member')
    renderPage('member', 'admin', adminValue)
    await user.click(await screen.findByRole('button', { name: '转让负责人' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/选择用户/)).toBeEnabled(),
    )
    await user.selectOptions(
      within(dialog).getByLabelText(/选择用户/),
      CANDIDATE_ID,
    )
    await user.click(within(dialog).getByRole('button', { name: '确认转让' }))
    await waitFor(() =>
      expect(adminValue.transferOwner).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        userId: CANDIDATE_ID,
        expectedUpdatedAt: project.updated_at,
      }),
    )
  })

  it('归档项目只显示历史成员并关闭全部写操作', async () => {
    const archived = {
      ...project,
      status: 'archived' as const,
      archived_at: '2026-08-05T03:00:00+00:00',
    }
    const value = projectValue('owner', {
      get: vi.fn(async () => ({ ok: true as const, data: archived })),
    })
    renderPage('owner', 'owner', value)
    expect(await screen.findByText(/仅供历史查看/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '添加成员' })).toBeNull()
    expect(screen.queryByRole('button', { name: '转让负责人' })).toBeNull()
  })

  it('候选响应跨工作空间时安全失败且确认保持禁用', async () => {
    const user = userEvent.setup()
    const value = projectValue('owner', {
      listMemberCandidates: vi.fn(async () => ({
        ok: true as const,
        data: [
          {
            ...candidate,
            workspace_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          },
        ],
      })),
    })
    renderPage('owner', 'member', value)
    await user.click(await screen.findByRole('button', { name: '添加成员' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '项目操作暂时无法完成',
    )
    expect(
      within(dialog).getByRole('button', { name: '确认添加' }),
    ).toBeDisabled()
  })

  it.each([320, 390])('%dpx 使用成员卡片而非宽表格', async (width) => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: width,
    })
    window.dispatchEvent(new Event('resize'))
    renderPage('viewer')
    expect(
      await screen.findByRole('list', { name: `${project.name}项目成员列表` }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('lead 通过明确对话框调整并移除普通成员', async () => {
    const user = userEvent.setup()
    const ordinary = {
      ...member(CANDIDATE_ID, 'member'),
      display_name: '虚构可调整成员',
    }
    const value = projectValue('lead', {
      listMembers: vi.fn(async () => ({
        ok: true as const,
        data: [
          member(OWNER_ID, 'owner'),
          member(FICTIONAL_APP_USER_ID, 'lead', true),
          ordinary,
        ],
      })),
    })
    renderPage('lead', 'member', value)
    const card = (
      await screen.findByRole('heading', { name: ordinary.display_name })
    ).closest('li')
    expect(card).not.toBeNull()
    await user.click(within(card!).getByRole('button', { name: '调整角色' }))
    let dialog = await screen.findByRole('dialog')
    await user.selectOptions(
      within(dialog).getByLabelText('新项目角色'),
      'viewer',
    )
    await user.click(within(dialog).getByRole('button', { name: '确认调整' }))
    await waitFor(() =>
      expect(value.setMemberRole).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        userId: CANDIDATE_ID,
        role: 'viewer',
      }),
    )

    const refreshedCard = (
      await screen.findByRole('heading', { name: ordinary.display_name })
    ).closest('li')
    await user.click(
      within(refreshedCard!).getByRole('button', { name: '移除成员' }),
    )
    dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('立即失去本项目的读取权限')
    await user.click(within(dialog).getByRole('button', { name: '确认移除' }))
    await waitFor(() =>
      expect(value.removeMember).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        userId: CANDIDATE_ID,
      }),
    )
  })

  it('清除 lead 使用明确后果说明和精确版本', async () => {
    const user = userEvent.setup()
    const withLead: Project = {
      ...project,
      owner_id: FICTIONAL_APP_USER_ID,
      owner_display_name: '虚构当前成员',
      lead_id: CANDIDATE_ID,
      lead_display_name: '虚构牵头人',
    }
    const value = projectValue('owner', {
      get: vi.fn(async () => ({ ok: true as const, data: withLead })),
    })
    renderPage('owner', 'member', value)
    await user.click(await screen.findByRole('button', { name: '清除牵头人' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('自动降为普通成员')
    await user.click(within(dialog).getByRole('button', { name: '确认清除' }))
    await waitFor(() =>
      expect(value.clearLead).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        expectedUpdatedAt: project.updated_at,
      }),
    )
  })

  it('并发冲突显示安全错误并重新读取，不泄露数据库细节', async () => {
    const user = userEvent.setup()
    const ordinary = {
      ...member(CANDIDATE_ID, 'member'),
      display_name: '虚构并发成员',
    }
    const listMembers = vi.fn(async () => ({
      ok: true as const,
      data: [member(FICTIONAL_APP_USER_ID, 'owner', true), ordinary],
    }))
    const value = projectValue('owner', {
      listMembers,
      setMemberRole: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: 'concurrent_update' as const,
          message: '项目已被其他人修改，请刷新后重试。',
        },
      })),
    })
    renderPage('owner', 'member', value)
    const card = (
      await screen.findByRole('heading', { name: ordinary.display_name })
    ).closest('li')
    await user.click(within(card!).getByRole('button', { name: '调整角色' }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(
      within(dialog).getByLabelText('新项目角色'),
      'viewer',
    )
    await user.click(within(dialog).getByRole('button', { name: '确认调整' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '项目已被其他人修改',
    )
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(2))
    expect(dialog).not.toHaveTextContent('public.project_members')
  })

  it('移除当前普通用户后重新读取失败，页面立即降级为安全错误态', async () => {
    const user = userEvent.setup()
    const currentOrdinary = {
      ...member(FICTIONAL_APP_USER_ID, 'member', true),
      display_name: '虚构当前普通成员',
    }
    const listMembers = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        data: [member(OWNER_ID, 'owner'), currentOrdinary],
      })
      .mockResolvedValueOnce({
        ok: false as const,
        error: {
          code: 'not_found_or_forbidden' as const,
          message: '项目不存在或你无权访问。',
        },
      })
    const value = projectValue('member', { listMembers })
    renderPage('member', 'admin', value)
    const card = (
      await screen.findByRole('heading', {
        name: new RegExp(currentOrdinary.display_name),
      })
    ).closest('li')
    await user.click(within(card!).getByRole('button', { name: '移除成员' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '确认移除' }))
    expect(
      await screen.findByRole('heading', { name: '无法打开项目成员' }),
    ).toBeInTheDocument()
    expect(screen.getByText('项目不存在或你无权访问。')).toBeInTheDocument()
  })
})

describe('成员数量当前/历史拆分', () => {
  it('成员页区分当前在用与停用历史数量并标记停用历史卡片', async () => {
    const inactive = {
      ...member('99999999-9999-4999-8999-999999999999', 'member', false, {
        isActive: false,
        activeMemberCount: 2,
        inactiveHistoricalMemberCount: 1,
      }),
      display_name: '虚构停用历史成员',
    }
    const value = projectValue('owner', {
      listMembers: vi.fn(async () => ({
        ok: true as const,
        data: [
          member(OWNER_ID, 'owner', false, {
            activeMemberCount: 2,
            inactiveHistoricalMemberCount: 1,
          }),
          member(FICTIONAL_APP_USER_ID, 'lead', true, {
            activeMemberCount: 2,
            inactiveHistoricalMemberCount: 1,
          }),
          inactive,
        ],
      })),
    })
    renderPage('owner', 'member', value)
    expect(
      await screen.findByRole('heading', { name: project.name }),
    ).toBeInTheDocument()
    expect(screen.getByText(/当前在用 2 人/)).toBeInTheDocument()
    expect(screen.getByText(/停用历史 1 人/)).toBeInTheDocument()
    const inactiveCard = (await screen.findByText('虚构停用历史成员')).closest(
      'li',
    )
    expect(inactiveCard).not.toBeNull()
    expect(
      within(inactiveCard!).getByText('已停用，仅保留历史'),
    ).toBeInTheDocument()
    // Inactive historical cards expose no member management actions.
    expect(
      within(inactiveCard!).queryByRole('button', { name: '移除成员' }),
    ).toBeNull()
  })

  it('归档项目仍拆分当前与历史数量', async () => {
    const archived = {
      ...project,
      status: 'archived' as const,
      archived_at: '2026-08-05T03:00:00+00:00',
    }
    const inactive = {
      ...member('99999999-9999-4999-8999-999999999999', 'member', false, {
        isActive: false,
        activeMemberCount: 1,
        inactiveHistoricalMemberCount: 1,
      }),
      display_name: '虚构归档停用成员',
    }
    const value = projectValue('owner', {
      get: vi.fn(async () => ({ ok: true as const, data: archived })),
      listMembers: vi.fn(async () => ({
        ok: true as const,
        data: [
          member(OWNER_ID, 'owner', false, {
            activeMemberCount: 1,
            inactiveHistoricalMemberCount: 1,
          }),
          inactive,
        ],
      })),
    })
    renderPage('owner', 'owner', value)
    expect(await screen.findByText(/仅供历史查看/)).toBeInTheDocument()
    expect(screen.getByText(/当前在用 1 人/)).toBeInTheDocument()
    expect(screen.getByText(/停用历史 1 人/)).toBeInTheDocument()
  })
})
