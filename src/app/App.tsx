import { BrowserRouter } from 'react-router-dom'
import { AppRouter } from '@/app/router/AppRouter'

export function App() {
  return (
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  )
}
