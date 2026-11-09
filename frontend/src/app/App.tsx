import { AuthProvider } from './providers/auth-provider'
import { AppRouter } from './router'
import { NewcomerLetterModal } from '../widgets/welcome/newcomer-letter'
import { CookieBanner } from '../widgets/cookie-banner/cookie-banner'

export function App() {
  return (
    <AuthProvider>
      <AppRouter />
      {/* Письмо Бывалого новичку: после создания персонажа игрок попадает в
          Участок милиции, он вне игровой оболочки — окно живёт на уровне приложения. */}
      <NewcomerLetterModal />
      <CookieBanner />
    </AuthProvider>
  )
}
