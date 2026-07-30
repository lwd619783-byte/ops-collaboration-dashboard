import { Route, Routes } from 'react-router'
import { AppLayout } from '@/app/layouts/AppLayout'
import { appNavigation } from '@/app/navigation/appNavigation'
import { HomePage } from '@/pages/HomePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
import { SystemHealthPage } from '@/pages/SystemHealthPage'
export function AppRouter() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        {appNavigation
          .slice(1)
          .filter((item) => item.path !== '/system-health')
          .map((item) => (
            <Route
              key={item.path}
              path={item.path}
              element={<PlaceholderPage title={item.title} />}
            />
          ))}
        <Route path="/system-health" element={<SystemHealthPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppLayout>
  )
}
