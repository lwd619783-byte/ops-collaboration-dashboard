import { Outlet } from 'react-router'
import { ProjectProvider } from '@/features/projects/ProjectProvider'
import type { SupabaseClientResolution } from '@/lib/supabase/client'

export function ProjectProviderLayout({
  resolveClient,
}: {
  resolveClient?: () => SupabaseClientResolution
}) {
  return (
    <ProjectProvider resolveClient={resolveClient}>
      <Outlet />
    </ProjectProvider>
  )
}
