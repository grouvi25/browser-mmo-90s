/**
 * Отправка пушей через Firebase Cloud Messaging, HTTP v1.
 *
 * Без SDK: ключ сервисного аккаунта подписывает JWT (RS256), Google меняет его
 * на токен доступа на час, им и шлём. Ключ — FCM_SERVICE_ACCOUNT в окружении
 * (JSON целиком или в base64). Нет ключа — пуши выключены, ошибок нет.
 */
import { createSign } from 'crypto'
import { env } from '../../config/env'
import { logger } from '../../shared/logger/logger'

type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string }

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token'

/** Разобрать ключ: JSON или base64 от JSON. Битый ключ — как будто его нет. */
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw?.trim()) return null
  for (const text of [raw.trim(), Buffer.from(raw.trim(), 'base64').toString('utf8')]) {
    try {
      const parsed = JSON.parse(text) as Partial<ServiceAccount>
      if (parsed.project_id && parsed.client_email && parsed.private_key) return parsed as ServiceAccount
    } catch { /* следующий вариант */ }
  }
  logger.warn('[Push] FCM_SERVICE_ACCOUNT задан, но не разобран: пуши выключены')
  return null
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

/** JWT для обмена на токен доступа Google (RFC 7523). */
export function signedAssertion(account: ServiceAccount, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(JSON.stringify({
    iss: account.client_email, scope: SCOPE, aud: account.token_uri ?? DEFAULT_TOKEN_URI,
    iat: nowSeconds, exp: nowSeconds + 3600,
  }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  return `${header}.${claims}.${base64url(signer.sign(account.private_key))}`
}

/** Сообщение FCM: заголовок, текст и экран, который открыть по тапу. */
export function fcmMessage(token: string, push: { title: string; body: string; url: string; kind: string }) {
  return {
    message: {
      token,
      notification: { title: push.title, body: push.body },
      // data — только строки. Заголовок и текст дублируются сюда: оболочка, которая
      // сама рисует уведомление из data, иначе показывала пустое (Дима, 07.11).
      data: { title: push.title, body: push.body, url: push.url, kind: push.kind },
      android: { priority: 'HIGH', notification: { channel_id: push.kind, tag: push.kind } },
    },
  }
}

let account: ServiceAccount | null | undefined
let cached: { token: string; until: number } | null = null

function currentAccount(): ServiceAccount | null {
  if (account === undefined) account = parseServiceAccount(env.FCM_SERVICE_ACCOUNT)
  return account
}

export const fcmEnabled = () => !!currentAccount()

async function accessToken(acc: ServiceAccount): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token
  const response = await fetch(acc.token_uri ?? DEFAULT_TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signedAssertion(acc) }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`token ${response.status}: ${(await response.text()).slice(0, 200)}`)
  const json = await response.json() as { access_token: string; expires_in: number }
  cached = { token: json.access_token, until: Date.now() + json.expires_in * 1000 }
  return json.access_token
}

/** Итог отправки: «gone» — телефон больше не принимает пуши, токен надо забыть. */
export type SendResult = 'sent' | 'gone' | 'failed' | 'disabled'

export async function sendFcm(token: string, push: { title: string; body: string; url: string; kind: string }): Promise<SendResult> {
  const acc = currentAccount()
  if (!acc) return 'disabled'
  try {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${acc.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken(acc)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fcmMessage(token, push)),
      signal: AbortSignal.timeout(10_000),
    })
    if (response.ok) return 'sent'
    const text = await response.text()
    // UNREGISTERED (404) и битый токен (400 INVALID_ARGUMENT) — приложение удалено или токен сменился.
    if (response.status === 404 || (response.status === 400 && text.includes('INVALID_ARGUMENT'))) return 'gone'
    logger.warn({ status: response.status, body: text.slice(0, 300) }, '[Push] FCM отказал')
    return 'failed'
  } catch (error) {
    logger.warn({ error }, '[Push] FCM недоступен')
    return 'failed'
  }
}

/** Для тестов: сбросить разобранный ключ и токен доступа. */
export function resetFcmForTests(raw?: string) {
  account = raw === undefined ? undefined : parseServiceAccount(raw)
  cached = null
}
