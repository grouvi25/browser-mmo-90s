// Пуши в приложении-оболочке (Android WebView, заказчик 06.11).
//
// Оболочка получает токен телефона от Firebase и отдаёт его странице:
//   - через мост `window.KooperativApp.getPushToken()` (addJavascriptInterface);
//   - или событием `kooperativ:push-token` с токеном в detail, когда токен сменился.
// Страница уже вошла в игру, поэтому сама отправляет токен на сервер своим входом:
// оболочке не нужен свой логин. В обычном браузере моста нет, и ничего не происходит.
import { request } from '../api/client'

type Bridge = { getPushToken?: () => string | null | undefined; platform?: () => string }
declare global { interface Window { KooperativApp?: Bridge } }

const SENT_KEY = 'koop_push_sent'

function bridgeToken(): string | null {
  try { return window.KooperativApp?.getPushToken?.()?.trim() || null } catch { return null }
}
function platform(): 'android' | 'ios' {
  try { return window.KooperativApp?.platform?.() === 'ios' ? 'ios' : 'android' } catch { return 'android' }
}

/** Отправить токен телефона на сервер, если он есть и ещё не отправлен этим аккаунтом. */
export async function syncPushToken(userId: string | null, token = bridgeToken()): Promise<void> {
  if (!userId || !token) return
  const mark = `${userId}:${token}`
  try { if (localStorage.getItem(SENT_KEY) === mark) return } catch { /* без памяти просто отправим снова */ }
  try {
    await request('/api/push/token', { method: 'POST', body: { token, platform: platform() } })
    try { localStorage.setItem(SENT_KEY, mark) } catch { /* приватный режим */ }
  } catch { /* сервер недоступен — повторим при следующем входе */ }
}

/** Выход из игры: телефон больше не получает пуши этого аккаунта. */
export async function forgetPushToken(): Promise<void> {
  const token = bridgeToken()
  try { localStorage.removeItem(SENT_KEY) } catch { /* ничего */ }
  if (!token) return
  try { await request('/api/push/token', { method: 'DELETE', body: { token } }) } catch { /* не страшно */ }
}

/** Оболочка сообщила новый токен (Firebase его иногда меняет). */
export function onPushToken(handler: (token: string) => void): () => void {
  const listener = (event: Event) => {
    const token = (event as CustomEvent<string>).detail
    if (typeof token === 'string' && token.trim()) handler(token.trim())
  }
  window.addEventListener('kooperativ:push-token', listener)
  return () => window.removeEventListener('kooperativ:push-token', listener)
}
