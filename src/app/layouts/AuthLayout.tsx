/**
 * AuthLayout: a minimal centered shell for public authentication pages
 * (/login, /forgot-password, /reset-password). It deliberately does NOT render
 * the business navigation or any business data.
 */

import { Link, Outlet } from 'react-router'

export function AuthLayout() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <Link className="brand" to="/login">
            运维协同看板
          </Link>
          <p className="eyebrow">登录访问工作空间</p>
        </div>
        <Outlet />
      </div>
    </div>
  )
}
