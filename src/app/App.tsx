import { BrowserRouter } from 'react-router'
import { AppRouter } from '@/app/router/AppRouter'

export function App() {
  return (
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  )
}
