// =============================================================
// ОПОВЕЩЕНИЯ В TELEGRAM
//
// Админка показывает проблему тому, кто в неё зашёл. Ночью и в выходные
// туда никто не заходит, а экономика ломается именно тогда: воркер
// считает метрики в 03:00 UTC, и алерт до утра лежит непрочитанным.
//
// Поэтому важное уходит в бота. Важное — это то, на что надо смотреть
// сегодня: пробитые пороги экономики и тяжёлые сигналы антиабуза.
//
// Что здесь принципиально:
//
//  * токен живёт ТОЛЬКО в окружении. Ни в базе, ни в ответах API его
//    нет: иначе доступ к админке означал бы и доступ к боту;
//  * без настроек модуль молчит и ничего не ломает — оповещения это
//    дополнение к панели, а не замена ей;
//  * один и тот же алерт не шлётся дважды в сутки. Бот, повторяющий
//    «доля стоков ниже нормы» каждый час, читается ровно один день,
//    после чего его отключают вместе со всеми остальными.
// =============================================================
import { env } from '../../config/env'
import { getRedis } from '../../shared/db/redis'
import { logger } from '../../shared/logger/logger'

/** Ключ дедупликации: код алерта плюс сутки. */
const sentKey = (code: string, date: string) => `telegram:sent:${date}:${code}`

/** Сколько живёт отметка об отправке — до конца следующих суток. */
const SENT_TTL_SECONDS = 36 * 60 * 60

export function telegramConfigured(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID)
}

/**
 * Отправка сообщения.
 *
 * Ошибки не выбрасываются наружу: упавший бот не должен ронять сбор
 * метрик или админский запрос. Они попадают в лог — там их и ищут.
 */
export async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  if (!telegramConfigured()) {
    return { ok: false, error: 'Не настроено: нет TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID' }
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      logger.error({ status: response.status, body: body.slice(0, 200) }, '[Telegram] Отправка не прошла')
      return { ok: false, error: `Telegram ответил ${response.status}` }
    }
    return { ok: true }
  } catch (err) {
    logger.error({ err }, '[Telegram] Сеть недоступна')
    return { ok: false, error: 'Не удалось связаться с Telegram' }
  }
}

export interface AlertNotice {
  code: string
  title: string
  what: string
  actual: string
  limit: string
}

/**
 * Шлёт алерты, которых сегодня ещё не было.
 *
 * Возвращает, сколько ушло: ноль означает либо «всё спокойно», либо «эти
 * же коды уже отправлены сегодня» — и то и другое нормально.
 */
export async function notifyAlerts(date: string, alerts: AlertNotice[], appUrl: string): Promise<number> {
  if (!telegramConfigured() || alerts.length === 0) return 0

  const redis = getRedis()
  let sent = 0

  for (const alert of alerts) {
    const key = sentKey(alert.code, date)
    // SET NX — атомарная заявка на отправку: два процесса, поднявшие один
    // и тот же алерт, не пришлют его дважды.
    const claimed = await redis.set(key, '1', 'EX', SENT_TTL_SECONDS, 'NX')
    if (claimed !== 'OK') continue

    const message = [
      `⚠️ <b>${escape(alert.title)}</b>`,
      escape(alert.what),
      `Порог: норма ${escape(alert.limit)}, сейчас <b>${escape(alert.actual)}</b>`,
      `Разбор и улики: ${appUrl}/admin`,
    ].join('\n\n')

    const result = await sendTelegram(message)
    if (result.ok) sent++
    else await redis.del(key) // не ушло — пусть попробует следующий прогон
  }
  return sent
}

/** Экранирование под parse_mode: HTML. */
function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
