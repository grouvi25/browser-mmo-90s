// =============================================================
// Личные уведомления в чате (правка заказчика, октябрь 2026):
// каждое действие — посадил, устроился, собрал, купил, сменили
// должность — оставляет строку от «Системы», которую видит только
// сам игрок. Запись не должна ронять действие: оно уже совершено,
// поэтому сбой здесь только в журнал.
// =============================================================
import { prisma } from '../../shared/db/prisma'
import { logger } from '../../shared/logger/logger'
import { chatDayStart } from './chat.formulas'

/** Сколько уведомлений держим на игрока: старые чистит записью новых. */
const KEEP = 100

export const NoticesService = {
  async push(characterId: string, text: string): Promise<void> {
    try {
      await prisma.gameNotice.create({ data: { characterId, text: text.slice(0, 300) } })
      // Чистка не на каждую запись: раз в десяток, чтобы не удваивать нагрузку.
      if (Math.random() < 0.1) {
        const old = await prisma.gameNotice.findMany({
          where: { characterId }, orderBy: { createdAt: 'desc' }, skip: KEEP, select: { id: true },
        })
        if (old.length) await prisma.gameNotice.deleteMany({ where: { id: { in: old.map(o => o.id) } } })
      }
    } catch (err) {
      logger.warn({ err, characterId }, '[Notices] push skipped')
    }
  },

  /** Свежие уведомления игрока, старые сверху. */
  async list(characterId: string, hours = 24, limit = 40, now = new Date()) {
    // Системные строки живут в той же ленте: после полуночи не должны
    // заполнять только что очищенный чат вчерашними действиями.
    const cutoff = new Date(Math.max(chatDayStart(now).getTime(), now.getTime() - hours * 3_600_000))
    const rows = await prisma.gameNotice.findMany({
      where: { characterId, createdAt: { gte: cutoff } },
      orderBy: { createdAt: 'desc' }, take: limit,
    })
    return rows.reverse().map(r => ({ id: r.id, text: r.text, createdAt: r.createdAt }))
  },
}
