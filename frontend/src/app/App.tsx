import { AuthProvider } from './providers/auth-provider'
import { AppRouter } from './router'
import { CookieBanner } from '../widgets/cookie-banner/cookie-banner'
import { AskTextHost } from '../widgets/ask-text/ask-text'

export function App() {
  return (
    <AuthProvider>
      <AppRouter />
      <CookieBanner />
      <AskTextHost />
    </AuthProvider>
  )
}
