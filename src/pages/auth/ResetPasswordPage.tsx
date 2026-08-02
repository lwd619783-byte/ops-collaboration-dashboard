/**
 * ResetPasswordPage: set a new password inside a valid recovery session.
 *
 * The form is only reachable when the AuthProvider holds a real recovery
 * session (PASSWORD_RECOVERY flow). A normal logged-in session is never
 * mistaken for a recovery session — even after a page refresh, because the
 * recovery marker is cleared on normal sign-in and after password update.
 * Invalid / expired / already-used links show a safe error with a link to
 * re-request. Passwords are never logged or echoed back.
 */

import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { InputField } from '@/components/forms/InputField'
import { useAuth } from '@/features/auth'
import { createSafeAuthError, type SafeAuthError } from '@/features/auth/errors'

const MIN_PASSWORD_LENGTH = 6

export function ResetPasswordPage() {
  const { isRecoverySession, updatePassword, status } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<SafeAuthError | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [succeeded, setSucceeded] = useState(false)

  const isUnauthenticated = status === 'unauthenticated'

  useEffect(() => {
    if (succeeded && isUnauthenticated) {
      // After a successful update the provider clears the session; move the
      // user back to the login page where they sign in with the new password.
      navigate('/login', { replace: true, state: { reset: true } })
    }
  }, [succeeded, isUnauthenticated, navigate])

  if (!isRecoverySession) {
    return (
      <section className="auth-page" aria-label="重置密码">
        <h2>重置密码</h2>
        <p className="form-error" role="alert" aria-live="assertive">
          重置密码链接无效或已过期，请重新申请。
        </p>
        <p className="auth-links">
          <Link className="text-link" to="/forgot-password">
            重新申请重置链接
          </Link>
        </p>
        <p className="auth-links">
          <Link className="text-link" to="/login">
            返回登录
          </Link>
        </p>
      </section>
    )
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return
    setFieldError(null)
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setFieldError(`新密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。`)
      return
    }
    if (password !== confirmation) {
      setFieldError('两次输入的密码不一致。')
      return
    }

    setIsSubmitting(true)
    try {
      const result = await updatePassword(password)
      if (result.ok) {
        setSucceeded(true)
        return
      }
      setError(result.error)
    } catch {
      setError(createSafeAuthError('unknown'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="auth-page" aria-label="重置密码">
      <h2>重置密码</h2>
      <p className="auth-description">设置一个新密码完成重置。</p>

      {succeeded && (
        <p className="form-notice" role="status" aria-live="polite">
          密码已更新，正在返回登录页…
        </p>
      )}
      {error && (
        <p className="form-error" role="alert" aria-live="assertive">
          {error.message}
        </p>
      )}

      <form className="auth-form" onSubmit={handleSubmit}>
        <InputField
          autoComplete="new-password"
          error={fieldError ?? undefined}
          label="新密码"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        <InputField
          autoComplete="new-password"
          label="确认新密码"
          onChange={(event) => setConfirmation(event.target.value)}
          required
          type="password"
          value={confirmation}
        />
        <div className="auth-actions">
          <Button disabled={isSubmitting} loading={isSubmitting} type="submit">
            更新密码
          </Button>
        </div>
      </form>

      <p className="auth-links">
        <Link className="text-link" to="/login">
          返回登录
        </Link>
      </p>
    </section>
  )
}
