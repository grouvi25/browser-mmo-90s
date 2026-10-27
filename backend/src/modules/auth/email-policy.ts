// =============================================================
// Какую почту принимаем при регистрации (просьба 28.10: «чтобы люди не
// регались с временной почтой или почтой с алиасами — точка и плюс»).
//
// 1. Нормализация. У Gmail точки в имени ничего не значат, а всё после
//    «+» — метка того же ящика: vasya, v.a.s.y.a и vasya+1@gmail.com —
//    один человек. Плюс-метку понимают и Яндекс, и Mail.ru, и Outlook, так
//    что её срезаем у всех. Яндекс отдаёт один ящик на нескольких доменах
//    и путает «-» с «.». Уникальность в базе — по нормализованной почте.
// 2. Одноразовые ящики — по списку доменов (data/disposable-domains.ts).
// 3. У домена должен быть почтовый сервер (MX): «gmail.comm» и «t.com»
//    на проде — опечатки и выдумки, на них не придёт и письмо о пароле.
//    Если DNS не ответил вовремя — пропускаем: игрок не виноват в сбое.
// =============================================================
import { promises as dns } from 'node:dns'
import { DISPOSABLE_DOMAINS } from './data/disposable-domains'

const GMAIL = new Set(['gmail.com', 'googlemail.com'])
const YANDEX = new Set(['yandex.ru', 'yandex.com', 'ya.ru', 'yandex.by', 'yandex.kz', 'yandex.ua', 'narod.ru'])

export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase()
  const at = email.lastIndexOf('@')
  if (at < 1) return email
  let local = email.slice(0, at)
  let domain = email.slice(at + 1)
  local = local.split('+')[0]
  if (GMAIL.has(domain)) {
    local = local.replace(/\./g, '')
    domain = 'gmail.com'
  } else if (YANDEX.has(domain)) {
    local = local.replace(/-/g, '.')
    domain = 'yandex.ru'
  }
  return `${local}@${domain}`
}

/** Домен почты и все его родители: sub.mailinator.com → mailinator.com. */
function domainChain(domain: string): string[] {
  const parts = domain.split('.')
  return parts.slice(0, -1).map((_, i) => parts.slice(i).join('.'))
}

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1] ?? ''
  return domainChain(domain).some(d => DISPOSABLE_DOMAINS.has(d))
}

export type MailDomainCheck = 'ok' | 'no-mail-server' | 'unknown'

/** Есть ли у домена почтовый сервер. MX, а при его отсутствии — A-запись
 *  (по стандарту почта тогда идёт на сам домен). */
export async function checkMailDomain(email: string, timeoutMs = 3000): Promise<MailDomainCheck> {
  const domain = email.trim().toLowerCase().split('@')[1] ?? ''
  if (!domain || !domain.includes('.')) return 'no-mail-server'
  const timeout = new Promise<'unknown'>(resolve => setTimeout(() => resolve('unknown'), timeoutMs))
  const lookup = (async (): Promise<MailDomainCheck> => {
    try {
      const mx = await dns.resolveMx(domain)
      if (mx.some(record => record.exchange && record.exchange !== '.')) return 'ok'
      return 'no-mail-server'
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOTFOUND' || code === 'ENODATA') {
        try {
          const a = await dns.resolve4(domain)
          return a.length > 0 ? 'ok' : 'no-mail-server'
        } catch (inner) {
          const innerCode = (inner as NodeJS.ErrnoException).code
          return innerCode === 'ENOTFOUND' || innerCode === 'ENODATA' ? 'no-mail-server' : 'unknown'
        }
      }
      return 'unknown'
    }
  })()
  return Promise.race([lookup, timeout])
}
