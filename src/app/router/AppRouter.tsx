import { Navigate, Route, Routes } from 'react-router'
import { AppLayout } from '@/app/layouts/AppLayout'
import { AuthLayout } from '@/app/layouts/AuthLayout'
import {
  appNavigation,
  legacyBusinessPathRedirects,
} from '@/app/navigation/appNavigation'
import { AuthProviderLayout } from '@/features/auth/AuthProviderLayout'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'
import { WorkspaceProviderLayout } from '@/features/workspaces/WorkspaceProviderLayout'
import { WorkspaceRequiredRoute } from '@/features/workspaces/WorkspaceRequiredRoute'
import { AccountActivationPage } from '@/pages/AccountActivationPage'
import { HomePage } from '@/pages/HomePage'
import { MembersPage } from '@/pages/MembersPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { SystemHealthPage } from '@/pages/SystemHealthPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'
import type { SupabaseClientResolution } from '@/lib/supabase/client'

type AppRouterProps = {
  resolveClient?: () => SupabaseClientResolution
}

/**
 * Route layout:
 *   /system-health  → public, OUTSIDE AuthProvider (never initializes identity)
 *   public 404      → public, OUTSIDE AuthProvider
 *   auth pages      → AuthLayout inside AuthProviderLayout
 *   business routes → ProtectedRoute + AppLayout inside AuthProviderLayout
 */
export function AppRouter({ resolveClient }: AppRouterProps) {
  return (
    <Routes>
      <Route path="/system-health" element={<SystemHealthPage />} />

      <Route element={<AuthProviderLayout resolveClient={resolveClient} />}>
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route
            element={<WorkspaceProviderLayout resolveClient={resolveClient} />}
          >
            <Route element={<AuthLayout />}>
              <Route
                path="/activate-account"
                element={<AccountActivationPage />}
              />
            </Route>

            <Route element={<WorkspaceRequiredRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<HomePage />} />
                {appNavigation
                  .slice(1)
                  .filter(
                    (item) =>
                      item.path !== '/system-health' &&
                      item.path !== '/settings' &&
                      item.path !== '/members',
                  )
                  .map((item) => (
                    <Route
                      key={item.path}
                      path={item.path}
                      element={<PlaceholderPage title={item.title} />}
                    />
                  ))}
                {legacyBusinessPathRedirects.map(({ from, to }) => (
                  <Route
                    key={from}
                    path={from}
                    element={<Navigate replace to={to} />}
                  />
                ))}
                <Route path="/members" element={<MembersPage />} />
                <Route path="/settings" element={<ProfilePage />} />
              </Route>
            </Route>
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
