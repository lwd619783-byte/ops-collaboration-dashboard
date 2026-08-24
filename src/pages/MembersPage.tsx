import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Dialog } from '@/components/ui/Dialog'
import { Table } from '@/components/ui/Table'
import { InputField } from '@/components/forms/InputField'
import { SelectField } from '@/components/forms/SelectField'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { useWorkspace } from '@/features/workspaces'
import type {
  WorkspaceMember,
  WorkspaceRole,
} from '@/features/workspaces/types'

const roleLabels: Record<WorkspaceRole, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  external_collaborator: '外部协作者',
}

const roleBadgeClasses: Record<WorkspaceRole, string> = {
  owner: 'badge-info',
  admin: 'badge-warning',
  member: 'badge-success',
  external_collaborator: 'badge-neutral',
}

const statusLabels = {
  invited: '待激活',
  active: '已启用',
  suspended: '已停用',
} as const

const statusBadgeClasses = {
  invited: 'badge-warning',
  active: 'badge-success',
  suspended: 'badge-danger',
} as const

function statusLabel(member: WorkspaceMember): string {
  if (member.status === 'invited') {
    // An invited member without a live invitation still needs the normal
    // re-invite path unless the guarded recovery action proves otherwise.
    return member.pending_invitation ? '待激活' : '待重新邀请'
  }
  return statusLabels[member.status]
}

type InviteForm = {
  email: string
  displayName: string
  role: Exclude<WorkspaceRole, 'owner'>
}

const initialInviteForm: InviteForm = {
  email: '',
  displayName: '',
  role: 'member',
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
}

export function MembersPage() {
  const workspace = useWorkspace()
  const current = workspace.currentWorkspace
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [membersState, setMembersState] = useState<
    'loading' | 'ready' | 'error'
  >('loading')
  const [membersError, setMembersError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isInviteOpen, setInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState<InviteForm>(initialInviteForm)
  const [inviteErrors, setInviteErrors] = useState<
    Partial<Record<keyof InviteForm, string>>
  >({})
  const [inviteRequestKey, setInviteRequestKey] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [isInviting, setInviting] = useState(false)
  const [roleTarget, setRoleTarget] = useState<WorkspaceMember | null>(null)
  const [selectedRole, setSelectedRole] = useState<WorkspaceRole>('member')
  const [statusTarget, setStatusTarget] = useState<WorkspaceMember | null>(null)
  const [isMutating, setMutating] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const actorRole = current?.role ?? null
  const canManage = actorRole === 'owner' || actorRole === 'admin'
  const assignableRoles = useMemo<Exclude<WorkspaceRole, 'owner'>[]>(
    () =>
      actorRole === 'owner'
        ? ['admin', 'member', 'external_collaborator']
        : ['member', 'external_collaborator'],
    [actorRole],
  )

  const loadMembers = useCallback(async () => {
    if (!current) return
    setMembersState('loading')
    setMembersError(null)
    const result = await workspace.listMembers(current.workspace_id)
    if (!result.ok) {
      setMembers([])
      setMembersError(result.error.message)
      setMembersState('error')
      return
    }
    setMembers(result.data)
    setMembersState('ready')
  }, [current, workspace])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void loadMembers()
    })
    return () => {
      cancelled = true
    }
  }, [loadMembers])

  const canManageTarget = (member: WorkspaceMember) => {
    if (!canManage || member.role === 'owner' || member.status === 'invited') {
      return false
    }
    if (actorRole === 'admin' && member.role === 'admin') return false
    return true
  }

  const canRecoverActivation = (member: WorkspaceMember) => {
    if (
      !canManage ||
      member.role === 'owner' ||
      member.status !== 'invited' ||
      member.pending_invitation
    ) {
      return false
    }
    if (actorRole === 'admin' && member.role === 'admin') return false
    return true
  }

  const updateInviteField = <K extends keyof InviteForm>(
    key: K,
    value: InviteForm[K],
  ) => {
    setInviteForm((currentForm) => ({ ...currentForm, [key]: value }))
    setInviteErrors((currentErrors) => ({ ...currentErrors, [key]: undefined }))
    setInviteError(null)
    setInviteRequestKey(null)
  }

  const closeInvite = () => {
    if (isInviting) return
    setInviteOpen(false)
    setInviteForm(initialInviteForm)
    setInviteErrors({})
    setInviteError(null)
    setInviteRequestKey(null)
  }

  const submitInvite = async () => {
    if (!current || isInviting) return
    const email = inviteForm.email.trim().toLowerCase()
    const displayName = inviteForm.displayName.trim()
    const errors: Partial<Record<keyof InviteForm, string>> = {}
    if (!isValidEmail(email) || email.length > 254) {
      errors.email = '请输入有效邮箱地址。'
    }
    if (displayName.length === 0 || displayName.length > 120) {
      errors.displayName = '显示名称须为 1 至 120 个字符。'
    }
    if (!assignableRoles.includes(inviteForm.role)) {
      errors.role = '当前角色无权发出此类邀请。'
    }
    if (Object.keys(errors).length > 0) {
      setInviteErrors(errors)
      return
    }

    setInviting(true)
    setInviteError(null)
    const idempotencyKey = inviteRequestKey ?? crypto.randomUUID()
    setInviteRequestKey(idempotencyKey)
    const result = await workspace.inviteMember({
      workspaceId: current.workspace_id,
      email,
      displayName,
      role: inviteForm.role,
      idempotencyKey,
    })
    if (!result.ok) {
      setInviteError(result.error.message)
      setInviting(false)
      return
    }

    setFeedback('邀请已安全发送。')
    setInviting(false)
    setInviteOpen(false)
    setInviteForm(initialInviteForm)
    setInviteErrors({})
    setInviteError(null)
    setInviteRequestKey(null)
    await loadMembers()
  }

  const submitRoleChange = async () => {
    if (!current || !roleTarget || isMutating) return
    setMutating(true)
    setMutationError(null)
    const result = await workspace.setMemberRole(
      current.workspace_id,
      roleTarget.user_id,
      selectedRole,
    )
    if (!result.ok) {
      setMutationError(result.error.message)
      setMutating(false)
      return
    }
    setRoleTarget(null)
    setMutating(false)
    setFeedback('成员角色已更新。')
    await loadMembers()
  }

  const submitStatusChange = async () => {
    if (!current || !statusTarget || isMutating) return
    setMutating(true)
    setMutationError(null)
    const previousStatus = statusTarget.status
    const nextStatus =
      previousStatus === 'invited' || previousStatus === 'suspended'
        ? 'active'
        : 'suspended'
    const result = await workspace.setMemberStatus(
      current.workspace_id,
      statusTarget.user_id,
      nextStatus,
    )
    if (!result.ok) {
      setMutationError(result.error.message)
      setMutating(false)
      return
    }
    setStatusTarget(null)
    setMutating(false)
    setFeedback(
      previousStatus === 'invited'
        ? '成员激活状态已恢复。'
        : nextStatus === 'active'
          ? '成员已重新启用。'
          : '成员已停用。',
    )
    await loadMembers()
  }

  if (!current) return null

  return (
    <div className="page-stack members-page">
      <section className="intro members-heading">
        <div>
          <p className="eyebrow">当前工作空间</p>
          <h2>{current.workspace_name}</h2>
          <p>成员目录仅显示工作所需资料，认证信息与联系方式不会在此返回。</p>
        </div>
        {canManage && (
          <Button onClick={() => setInviteOpen(true)}>邀请成员</Button>
        )}
      </section>

      {feedback && (
        <p aria-live="polite" className="confirmation" role="status">
          {feedback}
        </p>
      )}

      {membersState === 'loading' && <LoadingState title="正在加载成员" />}
      {membersState === 'error' && (
        <ErrorState
          title="暂时无法加载成员"
          description={membersError ?? '操作暂时无法完成，请稍后重试。'}
          action={
            <Button onClick={() => void loadMembers()} variant="secondary">
              重试
            </Button>
          }
        />
      )}
      {membersState === 'ready' && members.length === 0 && (
        <EmptyState
          title="暂无成员"
          description="当前工作空间还没有可显示的成员。"
        />
      )}
      {membersState === 'ready' && members.length > 0 && (
        <Table caption={`${current.workspace_name}成员列表`}>
          <thead>
            <tr>
              <th scope="col">成员</th>
              <th scope="col">单位 / 职位</th>
              <th scope="col">角色</th>
              <th scope="col">状态</th>
              {canManage && <th scope="col">操作</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.user_id}>
                <td>
                  <strong>{member.display_name}</strong>
                </td>
                <td>
                  <span>{member.organization_name ?? '未填写单位'}</span>
                  <small>{member.title ?? '未填写职位'}</small>
                </td>
                <td>
                  <Badge className={roleBadgeClasses[member.role]}>
                    {roleLabels[member.role]}
                  </Badge>
                </td>
                <td>
                  <Badge className={statusBadgeClasses[member.status]}>
                    {statusLabel(member)}
                  </Badge>
                </td>
                {canManage && (
                  <td>
                    {canRecoverActivation(member) ? (
                      <Button
                        onClick={() => {
                          setMutationError(null)
                          setStatusTarget(member)
                        }}
                        size="sm"
                        variant="secondary"
                      >
                        尝试恢复
                      </Button>
                    ) : canManageTarget(member) ? (
                      <div className="member-actions">
                        <Button
                          onClick={() => {
                            setMutationError(null)
                            setSelectedRole(member.role)
                            setRoleTarget(member)
                          }}
                          size="sm"
                          variant="secondary"
                        >
                          调整角色
                        </Button>
                        <Button
                          onClick={() => {
                            setMutationError(null)
                            setStatusTarget(member)
                          }}
                          size="sm"
                          variant={
                            member.status === 'suspended'
                              ? 'secondary'
                              : 'danger'
                          }
                        >
                          {member.status === 'suspended' ? '重新启用' : '停用'}
                        </Button>
                      </div>
                    ) : (
                      <span className="muted-text">无可用操作</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog
        confirmDisabled={isInviting}
        confirmLabel={isInviting ? '正在发送' : '发送邀请'}
        confirmLoading={isInviting}
        description="邀请将发送至该邮箱；系统只在业务数据库保存不可逆摘要和遮罩提示。"
        onClose={closeInvite}
        onConfirm={() => void submitInvite()}
        open={isInviteOpen}
        title="邀请工作空间成员"
      >
        <form
          className="dialog-form"
          id="workspace-invite-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submitInvite()
          }}
        >
          <InputField
            autoComplete="email"
            autoFocus
            disabled={isInviting}
            error={inviteErrors.email}
            label="邮箱"
            onChange={(event) => updateInviteField('email', event.target.value)}
            required
            type="email"
            value={inviteForm.email}
          />
          <InputField
            autoComplete="name"
            disabled={isInviting}
            error={inviteErrors.displayName}
            label="显示名称"
            maxLength={120}
            onChange={(event) =>
              updateInviteField('displayName', event.target.value)
            }
            required
            value={inviteForm.displayName}
          />
          <SelectField
            disabled={isInviting}
            error={inviteErrors.role}
            label="工作空间角色"
            onChange={(event) =>
              updateInviteField(
                'role',
                event.target.value as InviteForm['role'],
              )
            }
            required
            value={inviteForm.role}
          >
            {assignableRoles.map((role) => (
              <option key={role} value={role}>
                {roleLabels[role]}
              </option>
            ))}
          </SelectField>
          {inviteError && (
            <p className="form-error" role="alert">
              {inviteError}
            </p>
          )}
        </form>
      </Dialog>

      <Dialog
        confirmDisabled={isMutating || selectedRole === roleTarget?.role}
        confirmLabel={isMutating ? '正在更新' : '确认调整'}
        confirmLoading={isMutating}
        description={
          roleTarget
            ? `为“${roleTarget.display_name}”选择新的工作空间角色。`
            : '选择新的工作空间角色。'
        }
        onClose={() => !isMutating && setRoleTarget(null)}
        onConfirm={() => void submitRoleChange()}
        open={Boolean(roleTarget)}
        title="调整成员角色"
      >
        <SelectField
          disabled={isMutating}
          label="新角色"
          onChange={(event) =>
            setSelectedRole(event.target.value as WorkspaceRole)
          }
          value={selectedRole}
        >
          {assignableRoles.map((role) => (
            <option key={role} value={role}>
              {roleLabels[role]}
            </option>
          ))}
        </SelectField>
        {mutationError && (
          <p className="form-error" role="alert">
            {mutationError}
          </p>
        )}
      </Dialog>

      <Dialog
        confirmLabel={
          isMutating
            ? '正在处理'
            : statusTarget?.status === 'invited'
              ? '确认恢复'
              : statusTarget?.status === 'suspended'
                ? '确认启用'
                : '确认停用'
        }
        confirmLoading={isMutating}
        danger={statusTarget?.status === 'active'}
        description={
          statusTarget?.status === 'invited'
            ? '若该成员已完成认证且邀请链属于可恢复异常，系统将恢复其工作空间访问；否则会安全拒绝。普通邀请过期仍应重新发起邀请。'
            : statusTarget?.status === 'suspended'
              ? '重新启用后，该成员将恢复与角色相符的工作空间访问权限。'
              : '停用后，该成员将立即失去此工作空间的读取和管理权限，但不会停用其全局账号。'
        }
        onClose={() => !isMutating && setStatusTarget(null)}
        onConfirm={() => void submitStatusChange()}
        open={Boolean(statusTarget)}
        title={
          statusTarget?.status === 'invited'
            ? '尝试恢复成员激活'
            : statusTarget?.status === 'suspended'
              ? '重新启用成员'
              : '停用成员'
        }
      >
        {mutationError && (
          <p className="form-error" role="alert">
            {mutationError}
          </p>
        )}
      </Dialog>
    </div>
  )
}
