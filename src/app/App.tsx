import { BrowserRouter } from 'react-router'
import { AppRouter } from '@/app/router/AppRouter'
import { AuthProvider } from '@/features/auth/AuthProvider'

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </BrowserRouter>
  )
}
