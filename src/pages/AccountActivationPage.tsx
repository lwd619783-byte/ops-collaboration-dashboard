import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { InputField } from '@/components/forms/InputField'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { useAuth } from '@/features/auth'
import { useWorkspace } from '@/features/workspaces'

const roleLabels = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  external_collaborator: '外部协作者',
} as const

export function AccountActivationPage() {
  const navigate = useNavigate()
  const auth = useAuth()
  const workspace = useWorkspace()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [passwordWasUpdated, setPasswordWasUpdated] = useState(false)
  const [isSubmitting, setSubmitting] = useState(false)

  if (workspace.status === 'idle' || workspace.status === 'loading') {
    return <LoadingState title="正在读取邀请" />
  }
  if (workspace.status === 'error') {
    return (
      <ErrorState
        title="暂时无法读取邀请"
        description={
          workspace.error?.message ?? '操作暂时无法完成，请稍后重试。'
        }
        action={
          <Button onClick={() => void workspace.refresh()} variant="secondary">
            重试
          </Button>
        }
      />
    )
  }
  if (workspace.currentWorkspace) return <Navigate replace to="/" />

  const invitation = workspace.pendingInvitations[0]
  if (!invitation) {
    return (
      <EmptyState
        title="暂无可接受的邀请"
        description="邀请可能已过期、撤销、接受，或不属于当前账号。请联系管理员核对。"
      />
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (isSubmitting) return
    setSubmitError(null)
    setPasswordError(null)

    if (!passwordWasUpdated) {
      if (password.length < 8 || password.length > 72) {
        setPasswordError('密码须为 8 至 72 个字符。')
        return
      }
      if (password !== confirmation) {
        setPasswordError('两次输入的密码不一致。')
        return
      }
    }

    setSubmitting(true)
    if (!passwordWasUpdated) {
      const passwordResult = await auth.setInitialPassword(password)
      if (!passwordResult.ok) {
        setSubmitError(passwordResult.error.message)
        setSubmitting(false)
        return
      }
      setPasswordWasUpdated(true)
    }

    const acceptance = await workspace.acceptInvitation(
      invitation.invitation_id,
    )
    if (!acceptance.ok) {
      setSubmitError(
        `密码已设置，但邀请暂未接受。请保留当前页面并重试：${acceptance.error.message}`,
      )
      setSubmitting(false)
      return
    }

    await auth.completeAccountActivationSignOut()
    navigate('/login', { replace: true })
  }

  return (
    <section className="auth-page activation-page">
      <h2>激活工作空间账号</h2>
      <p className="auth-description">
        设置首个密码并接受邀请。完成后系统会安全退出，请使用新密码重新登录。
      </p>
      <dl className="activation-summary">
        <div>
          <dt>工作空间</dt>
          <dd>{invitation.workspace_name}</dd>
        </div>
        <div>
          <dt>目标角色</dt>
          <dd>{roleLabels[invitation.role]}</dd>
        </div>
        <div>
          <dt>邀请到期</dt>
          <dd>{new Date(invitation.expires_at).toLocaleString('zh-CN')}</dd>
        </div>
      </dl>

      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        {!passwordWasUpdated && (
          <>
            <InputField
              autoComplete="new-password"
              disabled={isSubmitting}
              error={passwordError ?? undefined}
              label="设置密码"
              maxLength={72}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            <InputField
              autoComplete="new-password"
              disabled={isSubmitting}
              label="确认密码"
              maxLength={72}
              minLength={8}
              onChange={(event) => setConfirmation(event.target.value)}
              required
              type="password"
              value={confirmation}
            />
          </>
        )}
        {passwordWasUpdated && (
          <p className="form-notice" role="status">
            密码已设置。现在仅重试接受工作空间邀请。
          </p>
        )}
        {submitError && (
          <p className="form-error" role="alert">
            {submitError}
          </p>
        )}
        <Button loading={isSubmitting} type="submit">
          {isSubmitting
            ? '正在激活'
            : passwordWasUpdated
              ? '重试接受邀请'
              : '设置密码并接受邀请'}
        </Button>
      </form>
    </section>
  )
}
