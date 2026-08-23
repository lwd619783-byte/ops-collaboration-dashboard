import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import {
  ACTIVATION_PHASE_STORAGE_KEY,
  RECOVERY_SESSION_STORAGE_KEY,
  type AuthServiceResult,
} from '@/features/auth/authService'
import {
  createSafeAuthError,
  mapInviteAuthError,
  type SafeAuthError,
} from '@/features/auth/errors'
import {
  getSupabaseClient,
  type SupabaseClientResolution,
} from '@/lib/supabase/client'

const MAX_INVITE_TOKEN_HASH_LENGTH = 512

type ConfirmAccountInvitationPageProps = {
  resolveClient?: () => SupabaseClientResolution
}

type InvitationCredential = {
  tokenHash: string
  hasValidShape: boolean
}

function invalidInviteLink(): SafeAuthError {
  return createSafeAuthError('invite_link_invalid')
}

function readInvitationCredential(fragment: string): InvitationCredential {
  const params = new URLSearchParams(
    fragment.startsWith('#') ? fragment.slice(1) : fragment,
  )
  const tokenHash = params.get('token_hash') ?? ''
  const inviteType = params.get('type')
  return {
    tokenHash,
    hasValidShape:
      inviteType === 'invite' &&
      tokenHash.length > 0 &&
      tokenHash.length <= MAX_INVITE_TOKEN_HASH_LENGTH,
  }
}

/**
 * User-controlled account-invitation confirmation boundary.
 *
 * The Hosted Supabase Invite User template should eventually land here with
 * an invite TokenHash in the URL fragment. Fragments are not sent in the HTTP
 * request, so the one-time credential stays out of Vercel request paths and
 * query strings. Merely loading the page NEVER verifies or consumes the token;
 * only an explicit user action calls verifyOtp(type='invite').
 */
export function ConfirmAccountInvitationPage({
  resolveClient = getSupabaseClient,
}: ConfirmAccountInvitationPageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [{ tokenHash, hasValidShape }] = useState<InvitationCredential>(() =>
    readInvitationCredential(location.hash),
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<SafeAuthError | null>(null)

  useEffect(() => {
    if (!location.hash) return
    // The credential has already been captured in short-lived component
    // memory. Remove it from browser history/address state before the user
    // acts, so refresh, history and address-bar sharing cannot retain it.
    navigate(location.pathname, { replace: true })
  }, [location.hash, location.pathname, navigate])

  const verifyInvitationToken = async (): Promise<AuthServiceResult> => {
    if (!hasValidShape) {
      return { ok: false, error: invalidInviteLink() }
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
      const { data, error: verifyError } =
        await resolution.client.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'invite',
        })
      if (verifyError) {
        return { ok: false, error: mapInviteAuthError(verifyError) }
      }
      if (!data.session) {
        return { ok: false, error: invalidInviteLink() }
      }
      return { ok: true, data: undefined }
    } catch (verifyError) {
      return { ok: false, error: mapInviteAuthError(verifyError) }
    }
  }

  const handleContinue = async () => {
    if (isSubmitting) return
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await verifyInvitationToken()
      if (!result.ok) {
        setError(result.error)
        return
      }

      // The verified invite session is now persisted by Supabase. Clear only
      // non-sensitive purpose/phase markers from any older browser session so
      // a stale password-recovery or prior activation state can never skip the
      // first-password step for this invitation. The TokenHash itself is never
      // copied to storage, logs, rendered text or long-lived app state.
      window.sessionStorage.removeItem(RECOVERY_SESSION_STORAGE_KEY)
      window.sessionStorage.removeItem(ACTIVATION_PHASE_STORAGE_KEY)
      navigate('/activate-account', { replace: true })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="auth-page" aria-label="确认账号邀请">
      <h2>确认账号邀请</h2>
      <p className="auth-description">
        为避免邮箱安全扫描器提前使用一次性邀请链接，请由你主动确认后再进入账号激活。
      </p>

      {!hasValidShape && (
        <p className="form-error" role="alert" aria-live="assertive">
          {invalidInviteLink().message}
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
            继续激活账号
          </Button>
        </div>
      )}

      <p className="auth-links">
        <Link className="text-link" to="/login">
          返回登录
        </Link>
      </p>
    </section>
  )
}
