import { Outlet } from 'react-router'
import { TaskProvider } from '@/features/tasks/TaskProvider'
import type { SupabaseClientResolution } from '@/lib/supabase/client'

export function TaskProviderLayout({
  resolveClient,
}: {
  resolveClient?: () => SupabaseClientResolution
}) {
  return (
    <TaskProvider resolveClient={resolveClient}>
      <Outlet />
    </TaskProvider>
  )
}
