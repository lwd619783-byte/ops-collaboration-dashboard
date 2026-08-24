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

const recoverableMember: WorkspaceMember = {
  ...owner,
  user_id: '55555555-5555-4555-8555-555555555555',
  display_name: '待恢复成员',
  role: 'member',
  status: 'invited',
  joined_at: null,
  pending_invitation: false,
}

const pendingMember: WorkspaceMember = {
  ...recoverableMember,
  user_id: '66666666-6666-4666-8666-666666666666',
  display_name: '正常待激活成员',
  pending_invitation: true,
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
      data: [owner, recoverableMember, pendingMember],
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

describe('工作空间激活断链恢复', () => {
  it('保留待重新邀请语义，并为没有有效 pending invitation 的 invited 成员提供条件性恢复入口', async () => {
    const user = userEvent.setup()
    const listMembers = vi.fn(async () => ({
      ok: true as const,
      data: [owner, recoverableMember, pendingMember],
    }))
    const setMemberStatus = vi.fn(async () => ({
      ok: true as const,
      data: undefined,
    }))

    renderMembers(
      workspaceValue('owner', {
        listMembers,
        setMemberStatus,
      }),
    )

    const recoverableRow = (await screen.findByText('待恢复成员')).closest(
      'tr',
    )!
    const pendingRow = screen.getByText('正常待激活成员').closest('tr')!

    expect(within(recoverableRow).getByText('待重新邀请')).toBeInTheDocument()
    expect(
      within(recoverableRow).getByRole('button', { name: '尝试恢复' }),
    ).toBeEnabled()
    expect(within(pendingRow).getByText('待激活')).toBeInTheDocument()
    expect(
      within(pendingRow).queryByRole('button', { name: '尝试恢复' }),
    ).toBeNull()
    expect(within(pendingRow).getByText('无可用操作')).toBeInTheDocument()

    await user.click(
      within(recoverableRow).getByRole('button', { name: '尝试恢复' }),
    )
    const dialog = screen.getByRole('dialog', {
      name: '尝试恢复成员激活',
    })
    expect(dialog).toHaveTextContent('普通邀请过期仍应重新发起邀请')
    await user.click(within(dialog).getByRole('button', { name: '确认恢复' }))

    await waitFor(() =>
      expect(setMemberStatus).toHaveBeenCalledWith(
        FICTIONAL_WORKSPACE_ID,
        recoverableMember.user_id,
        'active',
      ),
    )
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('status')).toHaveTextContent('成员激活状态已恢复。')
  })

  it('数据库拒绝恢复时保留对话框并只显示安全错误', async () => {
    const user = userEvent.setup()
    const setMemberStatus = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'activation_recovery_unavailable' as const,
        message: '该成员当前不满足安全恢复条件，请核对其认证与邀请状态。',
      },
    }))

    renderMembers(workspaceValue('owner', { setMemberStatus }))
    const recoverableRow = (await screen.findByText('待恢复成员')).closest(
      'tr',
    )!
    await user.click(
      within(recoverableRow).getByRole('button', { name: '尝试恢复' }),
    )
    const dialog = screen.getByRole('dialog', {
      name: '尝试恢复成员激活',
    })
    await user.click(within(dialog).getByRole('button', { name: '确认恢复' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '该成员当前不满足安全恢复条件，请核对其认证与邀请状态。',
    )
    expect(
      screen.getByRole('dialog', { name: '尝试恢复成员激活' }),
    ).toBeInTheDocument()
  })

  it('管理员不能借恢复入口激活另一个管理员', async () => {
    const invitedAdmin: WorkspaceMember = {
      ...recoverableMember,
      user_id: '77777777-7777-4777-8777-777777777777',
      display_name: '待恢复管理员',
      role: 'admin',
    }
    renderMembers(
      workspaceValue('admin', {
        listMembers: vi.fn(async () => ({
          ok: true as const,
          data: [owner, invitedAdmin],
        })),
      }),
    )

    const adminRow = (await screen.findByText('待恢复管理员')).closest('tr')!
    expect(within(adminRow).getByText('待重新邀请')).toBeInTheDocument()
    expect(
      within(adminRow).queryByRole('button', { name: '尝试恢复' }),
    ).toBeNull()
    expect(within(adminRow).getByText('无可用操作')).toBeInTheDocument()
  })
})
