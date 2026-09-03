// =============================================================
// РАЗБОР АНТИАБУЗА — фоновая часть шага G3 Этапа 5.
//
// Раз в сутки: пересобрать граф связей аккаунтов и прогнать детекторы.
// Ничего не наказывает — только поднимает сигналы для администратора
// (принцип П3).
//
// Сутки, а не минута, выбраны не из экономии: почти все правила смотрят на
// окно в трое суток или неделю, и чаще их гонять бессмысленно. Разбор
// идемпотентен — повторный прогон не плодит сигналы благодаря ключу повтора.
// =============================================================
import { logger } from '../shared/logger/logger'
import { runDetectors } from '../modules/antiabuse/antiabuse.service'

export const ANTIABUSE_MS = 24 * 60 * 60 * 1000

export async function runAntiAbuse(now = new Date()) {
  const result = await runDetectors(now)
  const raised = Object.entries(result)
    .filter(([key, value]) => key !== 'edges' && value > 0)
  if (raised.length > 0) {
    logger.warn({ result }, '[Worker] Antiabuse signals raised')
  }
  return result
}
