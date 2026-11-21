import { loginDestination } from './login-redirect'

// Реферальная ссылка ?ref=ник может вести на любую страницу (чаще на
// главную). Ник запоминаем при первом заходе и отдаём при регистрации.
const KEY = 'koop_ref'

function referralFromUrl(): string | undefined {
  const read = (search: string) => {
    const ref = new URLSearchParams(search).get('ref')?.trim()
    return ref && ref.length <= 64 ? ref : undefined
  }
  const ref = read(window.location.search)
  if (ref || window.location.pathname !== '/login') return ref
  // Старые ссылки ведут на /. Для гостя этот путь сохраняется в next.
  const destination = loginDestination(window.location.search)
  return read(new URL(destination, window.location.origin).search)
}

export function rememberReferral(): void {
  try {
    const ref = referralFromUrl()
    if (ref) localStorage.setItem(KEY, ref)
  } catch { /* Ссылка на регистрацию передаёт ник и без localStorage. */ }
}

export function storedReferral(): string | undefined {
  const ref = referralFromUrl()
  if (ref) return ref
  try {
    return localStorage.getItem(KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function referralLink(code: string): string {
  return `${window.location.origin}${registrationPath(code)}`
}

export function registrationPath(code = storedReferral()): string {
  return code ? '/register?' + new URLSearchParams({ ref: code }) : '/register'
}
