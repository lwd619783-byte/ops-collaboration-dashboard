import { Outlet } from 'react-router'
import { WorkspaceProvider } from '@/features/workspaces/WorkspaceProvider'
import type { SupabaseClientResolution } from '@/lib/supabase/client'

export function WorkspaceProviderLayout({
  resolveClient,
}: {
  resolveClient?: () => SupabaseClientResolution
}) {
  return (
    <WorkspaceProvider resolveClient={resolveClient}>
      <Outlet />
    </WorkspaceProvider>
  )
}
