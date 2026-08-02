/**
 * ForgotPasswordPage: request a password-reset email.
 *
 * The reset redirect target is the app-controlled /reset-password built by the
 * AuthProvider — the page never accepts an external redirect URL. Regardless of
 * whether the email exists, the SAME success message is shown, so the page
 * cannot be used to enumerate accounts. Rate-limit / network / service errors
 * map to safe, generic messages only.
 */

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { InputField } from '@/components/forms/InputField'
import { useAuth } from '@/features/auth'
import { createSafeAuthError, type SafeAuthError } from '@/features/auth/errors'

const GENERIC_RESET_MESSAGE = '若该邮箱已关联可用账号，系统将发送密码重置邮件。'

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sentMessage, setSentMessage] = useState<string | null>(null)
  const [error, setError] = useState<SafeAuthError | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return
    setError(null)
    setSentMessage(null)
    setIsSubmitting(true)
    try {
      const result = await requestPasswordReset(email)
      if (result.ok) {
        setSentMessage(GENERIC_RESET_MESSAGE)
        return
      }
      // Never reveal whether the email exists. Rate-limit / network failures
      // get their own safe copy; everything else shows the generic message.
      if (
        result.error.code === 'rate_limited' ||
        result.error.code === 'network_unavailable' ||
        result.error.code === 'supabase_unconfigured' ||
        result.error.code === 'supabase_config_invalid'
      ) {
        setError(result.error)
      } else {
        setSentMessage(GENERIC_RESET_MESSAGE)
      }
    } catch {
      setError(createSafeAuthError('unknown'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="auth-page" aria-label="忘记密码">
      <h2>忘记密码</h2>
      <p className="auth-description">输入账号邮箱，我们将发送密码重置链接。</p>

      {sentMessage && (
        <p className="form-notice" role="status" aria-live="polite">
          {sentMessage}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert" aria-live="assertive">
          {error.message}
        </p>
      )}

      <form className="auth-form" onSubmit={handleSubmit}>
        <InputField
          autoComplete="email"
          label="邮箱"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@example.com"
          required
          type="email"
          value={email}
        />
        <div className="auth-actions">
          <Button disabled={isSubmitting} loading={isSubmitting} type="submit">
            发送重置链接
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
