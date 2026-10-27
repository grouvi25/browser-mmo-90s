// =============================================================
// Отправка писем через ящик игры (noreply@kooperativ.space на почте
// Beget). Домен на почте Beget, и SPF разрешает отправку только её
// серверам, поэтому письма идут через smtp.beget.com, а не прямо с VPS.
//
// Без настроек в окружении письма не уходят, остальное работает как
// раньше. Ошибки наружу не выбрасываются: упавшая почта не должна ронять
// запрос игрока — вызывающий решает, куда отправить ссылку взамен.
// =============================================================
import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../../config/env'
import { logger } from '../logger/logger'

let transporter: Transporter | null = null

export function mailConfigured(): boolean {
  return !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS)
}

function transport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    })
  }
  return transporter
}

export async function sendMail(message: { to: string; subject: string; text: string; html?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!mailConfigured()) return { ok: false, error: 'Почта не настроена: нет SMTP_HOST, SMTP_USER или SMTP_PASS' }
  try {
    await transport().sendMail({
      from: { name: 'Кооператив', address: env.MAIL_FROM ?? env.SMTP_USER! },
      ...message,
    })
    return { ok: true }
  } catch (err) {
    logger.error({ err }, '[Почта] Письмо не ушло')
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
