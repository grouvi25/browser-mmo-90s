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
 * Сколько раз пробовать и с какой паузой.
 *
 * Замерено на проде (Beget, Санкт-Петербург): холодное соединение до
 * api.telegram.org отваливается по таймауту примерно в четверти попыток,
 * а следующая тут же проходит за 70–100 мс. Ни выбор семейства адресов,
 * ни порог гонки IPv4/IPv6 на это не влияют — канал просто рвётся.
 *
 * Три попытки превращают четверть потерь в примерно полтора процента.
 * Больше смысла нет: если не прошло трижды подряд, дело не в канале, и
 * ждать дольше — значит держать ночной сбор метрик.
 */
const ATTEMPTS = 3
const RETRY_PAUSE_MS = [400, 1200]

/** Соединение либо устанавливается за полсекунды, либо не установится. */
const REQUEST_TIMEOUT_MS = 8000

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Отправка сообщения.
 *
 * Ошибки не выбрасываются наружу: упавший бот не должен ронять сбор
 * метрик или админский запрос. Они попадают в лог — там их и ищут.
 *
 * Сетевые сбои повторяются, ответы Telegram — нет: 400 «chat not found»
 * не пройдёт и с десятой попытки, а вот повторять его — верный способ
 * получить бан по частоте запросов.
 */
export async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  if (!telegramConfigured()) {
    return { ok: false, error: 'Не настроено: нет TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID' }
  }

  let lastError = 'Не удалось связаться с Telegram'
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
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
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        logger.error({ status: response.status, body: body.slice(0, 200) }, '[Telegram] Отправка не прошла')
        return { ok: false, error: `Telegram ответил ${response.status}` }
      }
      if (attempt > 1) logger.info({ attempt }, '[Telegram] Сообщение ушло с повтора')
      return { ok: true }
    } catch (err) {
      lastError = 'Не удалось связаться с Telegram'
      logger.warn({ err, attempt, of: ATTEMPTS }, '[Telegram] Попытка не прошла')
      if (attempt < ATTEMPTS) await pause(RETRY_PAUSE_MS[attempt - 1] ?? 1200)
    }
  }
  logger.error({ attempts: ATTEMPTS }, '[Telegram] Сеть недоступна')
  return { ok: false, error: lastError }
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
