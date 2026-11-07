/**
 * Интернет-эквайринг Т-Банка (документацию прислал заказчик 28.10).
 *
 * Подпись (Token): значения полей корня запроса без вложенных объектов
 * плюс пароль терминала, по алфавиту ключей, склеить, SHA-256 (UTF-8).
 * Уведомление банка подписано так же — без поля Token.
 */
import { createHash, timingSafeEqual } from 'crypto'
import { env } from '../../config/env'

type Scalar = string | number | boolean
type Body = Record<string, unknown>

export const tbankConfigured = () => !!env.TBANK_TERMINAL_KEY && !!env.TBANK_PASSWORD

/** Токен запроса или уведомления. Вложенные объекты и массивы не участвуют. */
export function tbankToken(body: Body, password: string): string {
  const pairs: Array<[string, string]> = Object.entries(body)
    .filter(([key, value]) => key !== 'Token' && value !== null && value !== undefined && typeof value !== 'object')
    .map(([key, value]) => [key, String(value as Scalar)])
  pairs.push(['Password', password])
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return createHash('sha256').update(pairs.map(([, value]) => value).join(''), 'utf8').digest('hex')
}

/** Подлинность уведомления: подпись сходится и терминал наш. */
export function tbankNotificationValid(body: Body, terminalKey = env.TBANK_TERMINAL_KEY, password = env.TBANK_PASSWORD): boolean {
  if (!terminalKey || !password || typeof body.Token !== 'string' || body.TerminalKey !== terminalKey) return false
  const expected = Buffer.from(tbankToken(body, password))
  const got = Buffer.from(body.Token.toLowerCase())
  return expected.length === got.length && timingSafeEqual(expected, got)
}

/** Чек 54-ФЗ: одна позиция — игровые доллары как услуга. */
export function tbankReceipt(email: string, name: string, amountKopecks: number) {
  return {
    Email: email,
    Taxation: env.TBANK_TAXATION,
    Items: [{
      Name: name.slice(0, 128), Price: amountKopecks, Quantity: 1, Amount: amountKopecks,
      Tax: env.TBANK_VAT, PaymentMethod: 'full_payment', PaymentObject: 'service',
    }],
  }
}

export type InitResult = { ok: true; paymentId: string; paymentUrl: string } | { ok: false; error: string }

/** Создать платёж в банке и получить ссылку на страницу оплаты. */
export async function tbankInit(order: {
  orderId: string; amountKopecks: number; description: string; email: string | null
  notificationUrl: string; successUrl: string; failUrl: string
}): Promise<InitResult> {
  const terminalKey = env.TBANK_TERMINAL_KEY!
  const body: Body = {
    TerminalKey: terminalKey, Amount: order.amountKopecks, OrderId: order.orderId, Description: order.description.slice(0, 140),
    NotificationURL: order.notificationUrl, SuccessURL: order.successUrl, FailURL: order.failUrl, PayType: 'O',
  }
  if (env.TBANK_RECEIPT === 'on' && order.email) body.Receipt = tbankReceipt(order.email, order.description, order.amountKopecks)
  body.Token = tbankToken(body, env.TBANK_PASSWORD!)
  try {
    const response = await fetch(`${env.TBANK_API_URL.replace(/\/$/, '')}/Init`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    })
    const json = await response.json().catch(() => ({})) as { Success?: boolean; PaymentId?: string | number; PaymentURL?: string; Message?: string; Details?: string; ErrorCode?: string }
    if (json.Success && json.PaymentURL && json.PaymentId !== undefined) return { ok: true, paymentId: String(json.PaymentId), paymentUrl: json.PaymentURL }
    return { ok: false, error: [json.ErrorCode, json.Message, json.Details].filter(Boolean).join(' · ') || `HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'банк недоступен' }
  }
}
