/**
 * Battle Cleanup Worker — ТЗ раздел 22.4
 *
 * Закрывает бои, которые зависли: игрок вышел, соединение пропало, etc.
 * Запускается как cron внутри worker.ts каждые 5 минут.
 *
 * Критерии "orphaned battle":
 * - status = ACTIVE
 * - startedAt < now() - 2 часа (MAX_BATTLE_DURATION_MS)
 *
 * При завершении:
 * - Оба участника получают статус ACTIVE (выходят из боя)
 * - Бой помечается FINISHED с winnerId = null
 * - isSuspicious = true, suspicionReason = 'orphaned_timeout'
 * - Redis-состояние удаляется
 */

import { prisma } from '../shared/db/prisma'
import { BattleRedis } from '../shared/db/redis'
import { logger } from '../shared/logger/logger'
import { audit } from '../shared/logger/audit-logger'

const MAX_BATTLE_DURATION_MS = 2 * 60 * 60 * 1000 // 2 часа

export async function runBattleCleanup(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_BATTLE_DURATION_MS)

  const orphaned = await prisma.battle.findMany({
    where: {
      status: 'ACTIVE',
      startedAt: { lt: cutoff },
    },
    include: { participants: true },
    take: 50, // обрабатываем пачками
  })

  if (orphaned.length === 0) return

  logger.info({ count: orphaned.length }, '[BattleCleanup] Found orphaned battles')

  for (const battle of orphaned) {
    try {
      // Завершаем бой
      await prisma.battle.update({
        where: { id: battle.id },
        data: {
          status: 'FINISHED',
          winnerId: null,
          finishedAt: new Date(),
          isSuspicious: true,
          suspicionReason: 'orphaned_timeout',
        },
      })

      // Возвращаем всех игроков-участников в статус ACTIVE
      const characterIds = battle.participants
        .filter(p => p.characterId)
        .map(p => p.characterId!)

      if (characterIds.length > 0) {
        await prisma.character.updateMany({
          where: { id: { in: characterIds } },
          data: { status: 'ACTIVE' },
        })
      }

      // Чистим Redis
      await BattleRedis.deleteState(battle.id)

      audit('battle.cleanup.orphaned', {
        battleId: battle.id,
        characterIds,
        startedAt: battle.startedAt,
      })

    } catch (err) {
      logger.error({ err, battleId: battle.id }, '[BattleCleanup] Failed to close orphaned battle')
    }
  }

  logger.info({ count: orphaned.length }, '[BattleCleanup] Done')
}
