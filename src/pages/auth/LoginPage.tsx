/**
 * LoginPage: email + password sign-in.
 *
 * - Both fields have accessible labels and correct autocomplete attributes.
 * - Submit is disabled while pending; Enter submits the form.
 * - Failures render one unified safe message — never a raw Supabase error.
 * - No public registration entry.
 * - After sign-in the internal identity is validated by the AuthProvider
 *   BEFORE the page navigates; unavailable accounts land back here with the
 *   generic notice.
 */

import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { InputField } from '@/components/forms/InputField'
import { useAuth } from '@/features/auth'
import { sanitizeReturnTo } from '@/features/auth/returnTo'
import { createSafeAuthError, type SafeAuthError } from '@/features/auth/errors'

export function LoginPage() {
  const { signIn, notice, status } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<SafeAuthError | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const returnTo = sanitizeReturnTo(searchParams.get('returnTo'))
  const isCheckingIdentity = status === 'authenticated_checking_identity'

  useEffect(() => {
    if (status === 'authenticated_authorized') {
      navigate(returnTo, { replace: true })
    }
  }, [status, returnTo, navigate])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await signIn(email, password)
      if (!result.ok) {
        setError(result.error)
      }
      // On success the effect above navigates after identity validation.
    } catch {
      setError(createSafeAuthError('unknown'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="auth-page" aria-label="登录">
      <h2>登录</h2>
      <p className="auth-description">使用系统分配的账号登录后进入工作空间。</p>

      {notice && (
        <p className="form-notice" role="status" aria-live="polite">
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert" aria-live="assertive">
          {error.message}
        </p>
      )}
      {isCheckingIdentity && (
        <p className="form-notice" role="status" aria-live="polite">
          正在验证账号状态…
        </p>
      )}

      <form className="auth-form" onSubmit={handleSubmit} noValidate={false}>
        <InputField
          autoComplete="email"
          label="邮箱"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@example.com"
          required
          type="email"
          value={email}
        />
        <InputField
          autoComplete="current-password"
          label="密码"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        <div className="auth-actions">
          <Button
            disabled={isSubmitting}
            loading={isSubmitting || isCheckingIdentity}
            type="submit"
          >
            登录
          </Button>
        </div>
      </form>

      <p className="auth-links">
        <Link className="text-link" to="/forgot-password">
          忘记密码？
        </Link>
      </p>
    </section>
  )
}
