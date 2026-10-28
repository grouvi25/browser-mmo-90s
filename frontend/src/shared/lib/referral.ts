// Реферальная ссылка ?ref=ник может вести на любую страницу (чаще на
// главную). Ник запоминаем при первом заходе и отдаём при регистрации.
const KEY = 'koop_ref'

export function rememberReferral(): void {
  try {
    const ref = new URLSearchParams(window.location.search).get('ref')?.trim()
    if (ref && ref.length <= 64) localStorage.setItem(KEY, ref)
  } catch { /* приватный режим — просто без пригласившего */ }
}

export function storedReferral(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function referralLink(code: string): string {
  return `${window.location.origin}/?ref=${encodeURIComponent(code)}`
}
