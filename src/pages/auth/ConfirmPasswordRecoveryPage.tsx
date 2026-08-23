import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import {
  RECOVERY_SESSION_STORAGE_KEY,
  type AuthServiceResult,
} from '@/features/auth/authService'
import {
  createSafeAuthError,
  mapAuthError,
  type SafeAuthError,
} from '@/features/auth/errors'
import {
  getSupabaseClient,
  type SupabaseClientResolution,
} from '@/lib/supabase/client'

const MAX_RECOVERY_TOKEN_HASH_LENGTH = 512

type ConfirmPasswordRecoveryPageProps = {
  resolveClient?: () => SupabaseClientResolution
}

type RecoveryCredential = {
  tokenHash: string
  hasValidShape: boolean
}

function invalidRecoveryLink(): SafeAuthError {
  return createSafeAuthError('recovery_link_invalid')
}

function readRecoveryCredential(fragment: string): RecoveryCredential {
  const params = new URLSearchParams(
    fragment.startsWith('#') ? fragment.slice(1) : fragment,
  )
  const tokenHash = params.get('token_hash') ?? ''
  const recoveryType = params.get('type')
  return {
    tokenHash,
    hasValidShape:
      recoveryType === 'recovery' &&
      tokenHash.length > 0 &&
      tokenHash.length <= MAX_RECOVERY_TOKEN_HASH_LENGTH,
  }
}

/**
 * User-controlled password-recovery confirmation boundary.
 *
 * The email link lands here with a TokenHash in the URL fragment. Fragments are
 * not sent in the HTTP request, so the recovery credential is kept out of the
 * Vercel request path/search parameters. On mount, the fragment is captured in
 * short-lived component memory and then removed from browser history/address
 * state. Merely loading the page NEVER verifies or consumes the one-time token.
 * Only an explicit user click performs verifyOtp(type='recovery').
 */
export function ConfirmPasswordRecoveryPage({
  resolveClient = getSupabaseClient,
}: ConfirmPasswordRecoveryPageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [{ tokenHash, hasValidShape }] = useState<RecoveryCredential>(() =>
    readRecoveryCredential(location.hash),
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<SafeAuthError | null>(null)

  useEffect(() => {
    if (!location.hash) return
    // The credential has already been captured in component memory. Replace
    // the current history entry with the clean route before the user acts, so
    // refresh/history/address-bar sharing cannot retain the TokenHash.
    navigate(location.pathname, { replace: true })
  }, [location.hash, location.pathname, navigate])

  const verifyRecoveryToken = async (): Promise<AuthServiceResult> => {
    if (!hasValidShape) {
      return { ok: false, error: invalidRecoveryLink() }
    }

    const resolution = resolveClient()
    if (resolution.status !== 'ready') {
      return {
        ok: false,
        error: createSafeAuthError(
          resolution.reason === 'invalid'
            ? 'supabase_config_invalid'
            : 'supabase_unconfigured',
        ),
      }
    }

    try {
      const { data, error: verifyError } = await resolution.client.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'recovery',
      })
      if (verifyError) {
        return { ok: false, error: mapAuthError(verifyError) }
      }
      if (!data.session) {
        return { ok: false, error: invalidRecoveryLink() }
      }
      return { ok: true, data: undefined }
    } catch (verifyError) {
      return { ok: false, error: mapAuthError(verifyError) }
    }
  }

  const handleContinue = async () => {
    if (isSubmitting) return
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await verifyRecoveryToken()
      if (!result.ok) {
        setError(result.error)
        return
      }

      // Store only a non-sensitive boolean marker. The token hash itself is
      // never copied to storage, logs, rendered text or long-lived app state.
      // /reset-password mounts AuthProvider after verifyOtp has persisted the
      // verified Supabase session; the marker preserves the recovery purpose.
      window.sessionStorage.setItem(RECOVERY_SESSION_STORAGE_KEY, '1')
      navigate('/reset-password', { replace: true })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="auth-page" aria-label="确认密码重置">
      <h2>确认密码重置</h2>
      <p className="auth-description">
        为避免邮箱安全扫描器提前使用一次性链接，请由你主动确认后再进入密码重置。
      </p>

      {!hasValidShape && (
        <p className="form-error" role="alert" aria-live="assertive">
          {invalidRecoveryLink().message}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert" aria-live="assertive">
          {error.message}
        </p>
      )}

      {hasValidShape && (
        <div className="auth-actions">
          <Button
            disabled={isSubmitting}
            loading={isSubmitting}
            onClick={() => void handleContinue()}
            type="button"
          >
            继续重置密码
          </Button>
        </div>
      )}

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
