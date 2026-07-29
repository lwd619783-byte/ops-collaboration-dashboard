import { Route, Routes } from 'react-router'
import { AppLayout } from '@/app/layouts/AppLayout'
import { appNavigation } from '@/app/navigation/appNavigation'
import { HomePage } from '@/pages/HomePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
export function AppRouter() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        {appNavigation.slice(1).map((item) => (
          <Route
            key={item.path}
            path={item.path}
            element={<PlaceholderPage title={item.title} />}
          />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppLayout>
  )
}
