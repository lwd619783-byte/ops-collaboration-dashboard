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

export type AuthStatus =
  | 'initializing'
  | 'unauthenticated'
  | 'authenticated_checking_identity'
  | 'authenticated_authorized'
  | 'authenticated_unavailable'

export type AuthContextValue = {
  status: AuthStatus
  appUser: AppUser | null
  profile: Profile | null
  isRecoverySession: boolean
  notice: string | null
  clearNotice: () => void
  signIn: (email: string, password: string) => Promise<AuthServiceResult>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<AuthServiceResult>
  updatePassword: (password: string) => Promise<AuthServiceResult>
  updateProfile: (
    input: Pick<Profile, 'display_name' | 'organization_name' | 'title'>,
  ) => Promise<AuthServiceResult<Profile>>
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth 必须在 AuthProvider 内部使用。')
  }
  return context
}
