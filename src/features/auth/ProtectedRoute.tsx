/**
 * ProtectedRoute: guards business routes behind a fully resolved internal
 * identity. Unauthenticated visitors are redirected to /login with a safe
 * returnTo; during session/identity checks only a loading state is shown (no
 * business content flash). Unavailable accounts are signed out and the login
 * page shows the unified safe message.
 */

import { Navigate, Outlet, useLocation } from 'react-router'
import { LoadingState } from '@/components/feedback/LoadingState'
import { useAuth } from '@/features/auth'
import { sanitizeReturnTo } from '@/features/auth/returnTo'

function buildReturnTo(pathname: string, search: string, hash: string) {
  const candidate = `${pathname}${search}${hash}`
  return sanitizeReturnTo(candidate)
}

export function ProtectedRoute() {
  const { status, signOut } = useAuth()
  const location = useLocation()

  if (
    status === 'initializing' ||
    status === 'authenticated_checking_identity'
  ) {
    return (
      <div className="route-loading">
        <LoadingState title="正在验证登录状态" />
      </div>
    )
  }

  if (status === 'authenticated_authorized') {
    return <Outlet />
  }

  if (status === 'authenticated_unavailable') {
    // Unified safe handling: clear the session and show the login page with
    // the generic "account unavailable" notice. signOut is idempotent.
    void signOut()
    return (
      <div className="route-loading">
        <LoadingState title="正在安全退出" />
      </div>
    )
  }

  // unauthenticated: remember where the user wanted to go.
  const returnTo = buildReturnTo(
    location.pathname,
    location.search,
    location.hash,
  )
  const loginTarget =
    returnTo === '/'
      ? '/login'
      : `/login?returnTo=${encodeURIComponent(returnTo)}`
  return <Navigate replace to={loginTarget} />
}
