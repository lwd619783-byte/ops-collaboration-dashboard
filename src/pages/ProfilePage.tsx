/**
 * ProfilePage: edit the current user's own basic profile.
 *
 * Only the whitelisted fields display_name / organization_name / title are
 * submitted — never user_id, created_at, updated_at, provider, tenant or
 * subject, and no raw contact_info JSON editor. The database RLS remains the
 * final authorization boundary; even a known foreign user id cannot be
 * modified because RLS scopes updates to the caller's own row.
 *
 * The page distinguishes: loading / recoverable load error (with retry) /
 * profile row missing (with retry) / editable / save failed / saved — it never
 * shows an endless spinner when the profile is null.
 */

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { InputField } from '@/components/forms/InputField'
import { useAuth } from '@/features/auth'
import {
  PROFILE_LENGTH_LIMITS,
  type Profile,
} from '@/features/auth/authService'
import { createSafeAuthError, type SafeAuthError } from '@/features/auth/errors'

function ProfileForm({ profile }: { profile: Profile }) {
  const { updateProfile } = useAuth()
  const [displayName, setDisplayName] = useState(profile.display_name ?? '')
  const [organizationName, setOrganizationName] = useState(
    profile.organization_name ?? '',
  )
  const [title, setTitle] = useState(profile.title ?? '')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<SafeAuthError | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return
    setFieldError(null)
    setSubmitError(null)
    setSavedMessage(null)

    if (displayName.trim().length === 0) {
      setFieldError('显示名称不能为空。')
      return
    }
    if (displayName.trim().length > PROFILE_LENGTH_LIMITS.display_name) {
      setFieldError(
        `显示名称不能超过 ${PROFILE_LENGTH_LIMITS.display_name} 个字符。`,
      )
      return
    }

    setIsSubmitting(true)
    try {
      const result = await updateProfile({
        display_name: displayName,
        organization_name: organizationName,
        title,
      })
      if (result.ok) {
        setSavedMessage('个人资料已保存。')
        return
      }
      setSubmitError(result.error)
    } catch {
      setSubmitError(createSafeAuthError('unknown'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="card">
      <h2>个人资料</h2>
      <p>更新您的显示名称、组织与职位。其他字段由系统维护。</p>

      {savedMessage && (
        <p className="confirmation" role="status" aria-live="polite">
          {savedMessage}
        </p>
      )}
      {submitError && (
        <p className="form-error" role="alert" aria-live="assertive">
          {submitError.message}
        </p>
      )}

      <form className="profile-form" onSubmit={handleSubmit} noValidate={false}>
        <InputField
          autoComplete="name"
          error={fieldError ?? undefined}
          label="显示名称"
          onChange={(event) => setDisplayName(event.target.value)}
          required
          value={displayName}
        />
        <InputField
          autoComplete="organization"
          label="组织名称"
          onChange={(event) => setOrganizationName(event.target.value)}
          value={organizationName}
        />
        <InputField
          autoComplete="organization-title"
          label="职位"
          onChange={(event) => setTitle(event.target.value)}
          value={title}
        />
        <div className="auth-actions">
          <Button disabled={isSubmitting} loading={isSubmitting} type="submit">
            保存资料
          </Button>
        </div>
      </form>
    </div>
  )
}

export function ProfilePage() {
  const {
    status,
    appUser,
    profile,
    profileMissing,
    authError,
    retryAuthCheck,
  } = useAuth()

  // Loading: identity still being resolved.
  if (
    status === 'initializing' ||
    status === 'authenticated_checking_identity'
  ) {
    return (
      <section className="page-stack" aria-busy="true">
        <LoadingState title="正在加载个人资料" />
      </section>
    )
  }

  // Recoverable load error: fixed safe message + retry (no endless spinner).
  // The route-level error (authError) reaches this page because ProtectedRoute
  // keeps rendering the outlet tree? No — ProtectedRoute intercepts
  // authenticated_error and shows its own error state, so this branch only
  // matters when the page is reached with an authorized-but-failed profile.
  // The profile_read_failed path goes through authenticated_error and is
  // handled by ProtectedRoute; this branch covers any remaining recoverable
  // cases rendered directly.
  if (status === 'authenticated_error') {
    return (
      <section className="page-stack">
        <ErrorState
          title="暂时无法读取个人资料"
          description={authError?.message ?? '无法读取个人资料，请稍后重试。'}
          action={
            <Button onClick={retryAuthCheck} variant="secondary">
              重试
            </Button>
          }
        />
      </section>
    )
  }

  // Authorized but the profile row is missing: distinct, retryable state.
  if (status === 'authenticated_authorized' && (!appUser || !profile)) {
    if (profileMissing || !profile) {
      return (
        <section className="page-stack">
          <ErrorState
            title="个人资料暂不可用"
            description="未找到您的个人资料，请稍后重试或联系系统管理员。"
            action={
              <Button onClick={retryAuthCheck} variant="secondary">
                重试
              </Button>
            }
          />
        </section>
      )
    }
    return (
      <section className="page-stack" aria-busy="true">
        <LoadingState title="正在加载个人资料" />
      </section>
    )
  }

  return (
    <section className="page-stack">
      <ProfileForm key={profile?.user_id} profile={profile as Profile} />
    </section>
  )
}
