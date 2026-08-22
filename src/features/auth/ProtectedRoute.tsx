/**
 * ProtectedRoute: guards business routes behind a fully resolved internal
 * identity.
 *
 * - Unauthenticated visitors are redirected to /login with a safe returnTo.
 * - During session/identity checks only a loading state is shown (no business
 *   content flash).
 * - Confirmed-unavailable accounts are handled centrally by the AuthProvider
 *   (which performs the sign-out); this component only renders a neutral
 *   loading state until the provider transitions to unauthenticated. It NEVER
 *   calls signOut during render.
 * - Recoverable errors render a fixed safe message with a retry action.
 */

import { Navigate, Outlet, useLocation } from 'react-router'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { useAuth } from '@/features/auth'
import { sanitizeReturnTo } from '@/features/auth/returnTo'

function buildReturnTo(pathname: string, search: string, hash: string) {
  const candidate = `${pathname}${search}${hash}`
  return sanitizeReturnTo(candidate)
}

export function ProtectedRoute() {
  const { status, authError, invitationCallbackError, retryAuthCheck } =
    useAuth()
  const location = useLocation()

  if (location.pathname === '/activate-account' && invitationCallbackError) {
    const hasSessionConflict = invitationCallbackError === 'session_conflict'
    return (
      <div className="route-loading">
        <ErrorState
          title={
            hasSessionConflict ? '当前登录账号与邀请不一致' : '邀请链接无法使用'
          }
          description={
            hasSessionConflict
              ? '当前浏览器已登录其他账号。请先退出当前账号，再从邀请邮件重新进入。'
              : '该邀请无法继续使用，请联系工作空间管理员重新获取邀请。'
          }
        />
      </div>
    )
  }

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
    // The AuthProvider is performing the centralized sign-out; stay neutral
    // until it transitions to unauthenticated and redirects to /login.
    return (
      <div className="route-loading">
        <LoadingState title="正在安全退出" />
      </div>
    )
  }

  if (status === 'authenticated_recovery_only') {
    // A valid recovery (password reset) session that cannot resolve an
    // internal identity yet. Do NOT show protected content, do NOT run an
    // account-unavailable sign-out and do NOT show a permanent "signing out"
    // state: send the user back to the reset-password page, which is a public
    // route outside this guard, so no redirect loop is possible. The recovery
    // marker stays untouched so the password form remains usable.
    return <Navigate replace to="/reset-password" />
  }

  if (status === 'authenticated_error') {
    return (
      <div className="route-loading">
        <ErrorState
          title="暂时无法完成验证"
          description={authError?.message ?? '操作未能完成，请稍后重试。'}
          action={
            <Button onClick={retryAuthCheck} variant="secondary">
              重试
            </Button>
          }
        />
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
