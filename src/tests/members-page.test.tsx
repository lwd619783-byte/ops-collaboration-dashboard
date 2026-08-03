import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/workspaces/WorkspaceContext'
import type {
  WorkspaceMember,
  WorkspaceRole,
} from '@/features/workspaces/types'
import { MembersPage } from '@/pages/MembersPage'
import {
  FICTIONAL_APP_USER_ID,
  FICTIONAL_WORKSPACE_ID,
} from '@/tests/helpers/supabaseAuthMock'

const owner: WorkspaceMember = {
  user_id: FICTIONAL_APP_USER_ID,
  display_name: '所有者甲',
  organization_name: '示例单位',
  title: '负责人',
  avatar_url: null,
  role: 'owner',
  status: 'active',
  joined_at: '2026-01-01T00:00:00+00:00',
  disabled_at: null,
  pending_invitation: false,
}

const admin: WorkspaceMember = {
  ...owner,
  user_id: '22222222-2222-4222-8222-222222222222',
  display_name: '管理员乙',
  role: 'admin',
}

const member: WorkspaceMember = {
  ...owner,
  user_id: '33333333-3333-4333-8333-333333333333',
  display_name: '成员丙',
  role: 'member',
}

function workspaceValue(
  actorRole: WorkspaceRole,
  overrides: Partial<WorkspaceContextValue> = {},
): WorkspaceContextValue {
  return {
    status: 'ready',
    workspaces: [],
    currentWorkspace: {
      workspace_id: FICTIONAL_WORKSPACE_ID,
      workspace_name: '示例协同空间',
      role: actorRole,
      status: 'active',
      joined_at: '2026-01-01T00:00:00+00:00',
    },
    pendingInvitations: [],
    error: null,
    refresh: vi.fn(async () => undefined),
    listMembers: vi.fn(async () => ({
      ok: true as const,
      data: [owner, admin, member],
    })),
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
    ...overrides,
  }
}

function renderMembers(value: WorkspaceContextValue) {
  return render(
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        <MembersPage />
      </WorkspaceContext.Provider>
    </MemoryRouter>,
  )
}

describe('成员管理页权限边界', () => {
  it.each<WorkspaceRole>(['member', 'external_collaborator'])(
    '%s 只能读取安全成员目录，不能看到邀请或管理操作',
    async (actorRole) => {
      renderMembers(workspaceValue(actorRole))
      expect(await screen.findByText('所有者甲')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '邀请成员' })).toBeNull()
      expect(screen.queryByRole('columnheader', { name: '操作' })).toBeNull()
    },
  )

  it('所有者可管理管理员和普通成员，但所有者自身不可被调整或停用', async () => {
    renderMembers(workspaceValue('owner'))
    await screen.findByText('所有者甲')

    const ownerRow = screen.getByText('所有者甲').closest('tr')
    const adminRow = screen.getByText('管理员乙').closest('tr')
    const memberRow = screen.getByText('成员丙').closest('tr')
    expect(ownerRow).not.toBeNull()
    expect(adminRow).not.toBeNull()
    expect(memberRow).not.toBeNull()
    expect(within(ownerRow!).getByText('无可用操作')).toBeInTheDocument()
    expect(
      within(adminRow!).getByRole('button', { name: '调整角色' }),
    ).toBeInTheDocument()
    expect(
      within(memberRow!).getByRole('button', { name: '停用' }),
    ).toBeInTheDocument()
  })

  it('管理员不能管理所有者或其他管理员，且邀请角色不包含管理员', async () => {
    const user = userEvent.setup()
    renderMembers(workspaceValue('admin'))
    await screen.findByText('管理员乙')

    expect(
      within(screen.getByText('所有者甲').closest('tr')!).getByText(
        '无可用操作',
      ),
    ).toBeInTheDocument()
    expect(
      within(screen.getByText('管理员乙').closest('tr')!).getByText(
        '无可用操作',
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '邀请成员' }))
    const dialog = screen.getByRole('dialog', { name: '邀请工作空间成员' })
    const roleSelect = within(dialog).getByLabelText(/工作空间角色/)
    expect(
      within(roleSelect).queryByRole('option', { name: '管理员' }),
    ).toBeNull()
    expect(
      within(roleSelect).getByRole('option', { name: '成员' }),
    ).toBeInTheDocument()
    expect(
      within(roleSelect).getByRole('option', { name: '外部协作者' }),
    ).toBeInTheDocument()
  })
})

describe('成员管理页写操作', () => {
  it('邀请请求未完成时禁用重复提交', async () => {
    const user = userEvent.setup()
    let resolveInvite:
      ((value: { ok: true; data: undefined }) => void) | undefined
    const inviteMember = vi.fn(
      () =>
        new Promise<{ ok: true; data: undefined }>((resolve) => {
          resolveInvite = resolve
        }),
    )
    renderMembers(workspaceValue('owner', { inviteMember }))
    await screen.findByText('成员丙')
    await user.click(screen.getByRole('button', { name: '邀请成员' }))
    const dialog = screen.getByRole('dialog', { name: '邀请工作空间成员' })
    await user.type(
      within(dialog).getByLabelText(/邮箱/),
      'invitee@example.invalid',
    )
    await user.type(within(dialog).getByLabelText(/显示名称/), '受邀成员')
    await user.click(within(dialog).getByRole('button', { name: '发送邀请' }))

    const pendingButton = within(dialog).getByRole('button', {
      name: /^正在发送/,
    })
    expect(pendingButton).toBeDisabled()
    await user.click(pendingButton)
    expect(inviteMember).toHaveBeenCalledTimes(1)

    resolveInvite?.({ ok: true, data: undefined })
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('邀请已安全发送。'),
    )
  })

  it('前端校验邀请字段，失败重试复用同一幂等键，成功后服务端回读', async () => {
    const user = userEvent.setup()
    const inviteMember = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        error: { code: 'temporary_failure' as const, message: '安全失败提示' },
      })
      .mockResolvedValueOnce({ ok: true as const, data: undefined })
    const listMembers = vi.fn(async () => ({
      ok: true as const,
      data: [owner, member],
    }))
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '44444444-4444-4444-8444-444444444444',
    )
    renderMembers(
      workspaceValue('owner', {
        inviteMember,
        listMembers,
      }),
    )
    await screen.findByText('成员丙')
    await user.click(screen.getByRole('button', { name: '邀请成员' }))
    const dialog = screen.getByRole('dialog', { name: '邀请工作空间成员' })
    await user.click(within(dialog).getByRole('button', { name: '发送邀请' }))
    expect(within(dialog).getByText('请输入有效邮箱地址。')).toBeInTheDocument()
    expect(
      within(dialog).getByText('显示名称须为 1 至 120 个字符。'),
    ).toBeInTheDocument()

    await user.type(
      within(dialog).getByLabelText(/邮箱/),
      ' Invitee@Example.invalid ',
    )
    await user.type(within(dialog).getByLabelText(/显示名称/), '受邀成员')
    await user.click(within(dialog).getByRole('button', { name: '发送邀请' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '安全失败提示',
    )
    await user.click(within(dialog).getByRole('button', { name: '发送邀请' }))

    await waitFor(() => expect(inviteMember).toHaveBeenCalledTimes(2))
    const first = inviteMember.mock.calls[0][0]
    const second = inviteMember.mock.calls[1][0]
    expect(first).toEqual({
      workspaceId: FICTIONAL_WORKSPACE_ID,
      email: 'invitee@example.invalid',
      displayName: '受邀成员',
      role: 'member',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    })
    expect(second.idempotencyKey).toBe(first.idempotencyKey)
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('status')).toHaveTextContent('邀请已安全发送。')
  })

  it('角色和状态变更成功后均重新读取成员列表', async () => {
    const user = userEvent.setup()
    const listMembers = vi.fn(async () => ({
      ok: true as const,
      data: [owner, member],
    }))
    const setMemberRole = vi.fn(async () => ({
      ok: true as const,
      data: undefined,
    }))
    const setMemberStatus = vi.fn(async () => ({
      ok: true as const,
      data: undefined,
    }))
    renderMembers(
      workspaceValue('owner', {
        listMembers,
        setMemberRole,
        setMemberStatus,
      }),
    )
    const memberRow = (await screen.findByText('成员丙')).closest('tr')!
    await user.click(
      within(memberRow).getByRole('button', { name: '调整角色' }),
    )
    const roleDialog = screen.getByRole('dialog', { name: '调整成员角色' })
    await user.selectOptions(
      within(roleDialog).getByLabelText('新角色'),
      'external_collaborator',
    )
    await user.click(
      within(roleDialog).getByRole('button', { name: '确认调整' }),
    )
    await waitFor(() =>
      expect(setMemberRole).toHaveBeenCalledWith(
        FICTIONAL_WORKSPACE_ID,
        member.user_id,
        'external_collaborator',
      ),
    )
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(2))

    await user.click(within(memberRow).getByRole('button', { name: '停用' }))
    const statusDialog = screen.getByRole('dialog', { name: '停用成员' })
    await user.click(
      within(statusDialog).getByRole('button', { name: '确认停用' }),
    )
    await waitFor(() =>
      expect(setMemberStatus).toHaveBeenCalledWith(
        FICTIONAL_WORKSPACE_ID,
        member.user_id,
        'suspended',
      ),
    )
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(3))
  })

  it.each([390, 320])(
    '%dpx 视口保留表格滚动容器和键盘可达操作',
    async (width) => {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: width,
      })
      window.dispatchEvent(new Event('resize'))
      renderMembers(workspaceValue('owner'))

      const table = await screen.findByRole('table', {
        name: '示例协同空间成员列表',
      })
      expect(table.parentElement).toHaveClass('table-wrap')
      expect(screen.getByRole('button', { name: '邀请成员' })).toBeEnabled()
      expect(
        within(screen.getByText('成员丙').closest('tr')!).getByRole('button', {
          name: '调整角色',
        }),
      ).toBeEnabled()
    },
  )
})
