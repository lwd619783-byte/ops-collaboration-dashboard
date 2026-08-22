/**
 * Auth context + hook, split from AuthProvider so the provider file only
 * exports components (react-refresh requirement).
 */

import { createContext, useContext } from 'react'
import type {
  AuthServiceResult,
  AppUser,
  Profile,
} from '@/features/auth/authService'
import type { SafeAuthError } from '@/features/auth/errors'
import type { InvitationCallbackErrorReason } from '@/features/auth/invitationCallback'

export type AuthStatus =
  | 'initializing'
  | 'unauthenticated'
  | 'authenticated_checking_identity'
  | 'authenticated_authorized'
  | 'authenticated_unavailable'
  /**
   * Recoverable, safe error state: a network / configuration / profile read
   * failure that must NOT be reported as "account disabled" and must NOT
   * trigger a permanent sign-out. The UI shows a fixed safe message with a
   * retry action.
   */
  | 'authenticated_error'
  /**
   * A valid recovery (password reset) session whose internal identity cannot
   * be resolved. The session is KEPT so the user can set a new password, but
   * business routes must never be authorized: ProtectedRoute redirects these
   * users back to /reset-password instead of showing protected content or a
   * permanent "signing out" state. No account-unavailable sign-out happens.
   */
  | 'authenticated_recovery_only'

export type AuthConfigState = 'unconfigured' | 'invalid' | null

export type AuthContextValue = {
  status: AuthStatus
  appUser: AppUser | null
  profile: Profile | null
  /** Safe error for the recoverable `authenticated_error` state. */
  authError: SafeAuthError | null
  /** True when the profile row is missing but the identity is valid. */
  profileMissing: boolean
  /** Preserved reason when the Supabase client could not be built. */
  configState: AuthConfigState
  isRecoverySession: boolean
  /** Safe, route-scoped result for an invalid/failed invitation callback. */
  invitationCallbackError: false | InvitationCallbackErrorReason
  /**
   * True while the FIRST-ACTIVATION phase has set the initial password and is
   * waiting to accept the workspace invitation. It survives USER_UPDATED
   * re-resolution, React re-renders and page refreshes (controlled
   * sessionStorage), and is cleared by the provider at every authoritative
   * boundary: activation completion, explicit sign-out, session loss, user
   * switch, new sign-in and safe termination.
   */
  activationPasswordSet: boolean
  notice: string | null
  clearNotice: () => void
  signIn: (email: string, password: string) => Promise<AuthServiceResult>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<AuthServiceResult>
  updatePassword: (password: string) => Promise<AuthServiceResult>
  setInitialPassword: (password: string) => Promise<AuthServiceResult>
  completeAccountActivationSignOut: () => Promise<void>
  updateProfile: (
    input: Pick<Profile, 'display_name' | 'organization_name' | 'title'>,
  ) => Promise<AuthServiceResult<Profile>>
  refreshProfile: () => Promise<void>
  /** Re-run the identity / profile resolution from the current session. */
  retryAuthCheck: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth 必须在 AuthProvider 内部使用。')
  }
  return context
}
