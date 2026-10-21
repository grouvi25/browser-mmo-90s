const invalidCharacters = (value: string) => Array.from(value).some(char => char === '\\' || char.charCodeAt(0) <= 32)

/** Only local game destinations may survive an authentication redirect. */
export function loginDestination(search: string): string {
  const next = new URLSearchParams(search).get('next')
  if (!next || !next.startsWith('/') || next.startsWith('//') || invalidCharacters(next)) return '/resume'
  // Decode the pathname for validation as well (encoded slashes/backslashes and loops).
  try {
    const path = decodeURIComponent(next.split(/[?#]/)[0])
    if (path.startsWith('//') || invalidCharacters(path) || /^\/(login|register|resume|admin)(?:\/|$)/i.test(path)) return '/resume'
  } catch { return '/resume' }
  return next
}

export function loginUrl(returnTo: string, expired = false): string {
  const params = new URLSearchParams({ next: returnTo })
  if (expired) params.set('reason', 'session-expired')
  return `/login?${params}`
}
