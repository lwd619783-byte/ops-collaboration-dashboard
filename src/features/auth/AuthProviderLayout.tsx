/**
 * AuthProviderLayout: scopes the AuthProvider to the routes that actually need
 * authentication state (auth pages + protected business routes). Public routes
 * rendered outside this layout (e.g. /system-health) never mount the provider,
 * so they never call auth.getSession(), current_app_user_id() or read
 * app_users / profiles.
 */

import { Outlet } from 'react-router'
import { AuthProvider } from '@/features/auth/AuthProvider'
import type { SupabaseClientResolution } from '@/lib/supabase/client'

type AuthProviderLayoutProps = {
  resolveClient?: () => SupabaseClientResolution
}

export function AuthProviderLayout({ resolveClient }: AuthProviderLayoutProps) {
  return (
    <AuthProvider resolveClient={resolveClient}>
      <Outlet />
    </AuthProvider>
  )
}
