/**
 * Battle Cleanup Worker — ТЗ раздел 22.4
 *
 * Закрывает бои, которые зависли: игрок вышел, соединение пропало, etc.
 * Запускается как cron внутри worker.ts каждые 5 минут.
 *
 * Критерии "orphaned battle":
 * - status = ACTIVE
 * - startedAt < now() - 2 часа (MAX_BATTLE_DURATION_MS)
 * - либо живого состояния в Redis нет дольше LOST_STATE_GRACE_MS.
 *   Бой живёт в Redis; после перезапуска Redis (выкат) запись в базе
 *   оставалась ACTIVE, воркер таймаутов её пропускал, а клиент два часа
 *   уводил игрока на экран боя, где ходить уже нечем («я завис в бою»).
 *
 * Отдельно отпускаются персонажи, застрявшие в статусе IN_BATTLE без
 * единого незавершённого боя: в бой их не пускало («Вы уже в бою»), а
 * вернуться было некуда.
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
/** Заявка старого образца (до заявок с таймером) ждёт соперника столько — и снимается. */
export const LEGACY_WAITING_MS = 30 * 60 * 1000
/** Бой создаётся в базе чуть раньше, чем его состояние ложится в Redis. */
export const LOST_STATE_GRACE_MS = 2 * 60 * 1000

export async function runBattleCleanup(): Promise<void> {
  const now = Date.now()
  const cutoff = new Date(now - MAX_BATTLE_DURATION_MS)

  const expired = await prisma.battle.findMany({
    where: {
      status: 'ACTIVE',
      startedAt: { lt: cutoff },
    },
    include: { participants: true },
    take: 50, // обрабатываем пачками
  })

  const candidates = await prisma.battle.findMany({
    where: { status: 'ACTIVE', startedAt: { lt: new Date(now - LOST_STATE_GRACE_MS), gte: cutoff } },
    include: { participants: true },
    take: 200,
  })
  const lost: typeof candidates = []
  for (const battle of candidates) {
    if (!(await BattleRedis.getState(battle.id))) lost.push(battle)
  }

  const orphaned = [...expired, ...lost]
  await cancelLegacyWaiting(new Date(now))
  await releaseStuckCharacters()
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
          suspicionReason: lost.includes(battle) ? 'state_lost' : 'orphaned_timeout',
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

/**
 * Заявки старого образца: созданы до заявок с таймером (без startsAt) и
 * ждут соперника вечно. Принять их уже нечем — ручки убраны, — а создатель
 * всё это время числится «в бою» и не может ни драться, ни работать
 * (так висели test1 и Admin с 14 октября). Снимаем, а персонажей
 * отпускает releaseStuckCharacters ниже.
 *
 * Осада создаёт бой без startsAt на секунды до старта, поэтому порог —
 * полчаса; бои за районы (TERRITORY), осады и налёты на дома не трогаем вовсе.
 */
export async function cancelLegacyWaiting(now = new Date()): Promise<number> {
  const sieges = [
    ...await prisma.houseSiege.findMany({ where: { battleId: { not: null } }, select: { battleId: true } }),
    ...await prisma.homeRaid.findMany({ where: { battleId: { not: null } }, select: { battleId: true } }),
  ]
  const cancelled = await prisma.battle.updateMany({
    where: {
      status: 'WAITING_PLAYERS',
      startsAt: null,
      type: { in: ['PVP_DUEL', 'CLAN'] },
      createdAt: { lt: new Date(now.getTime() - LEGACY_WAITING_MS) },
      id: { notIn: sieges.map(s => s.battleId!) },
    },
    data: { status: 'CANCELLED', finishedAt: now },
  })
  if (cancelled.count) audit('battle.cleanup.legacy_waiting', { count: cancelled.count })
  return cancelled.count
}

/**
 * Персонаж в статусе IN_BATTLE, у которого нет ни идущего, ни
 * собирающегося боя, возвращается в город. Такое оставалось после
 * сбоев на старте боя и после ручного закрытия боёв.
 */
export async function releaseStuckCharacters(): Promise<number> {
  const stuck = await prisma.character.findMany({
    where: {
      status: 'IN_BATTLE',
      battlesAsParticipant: { none: { battle: { status: { in: ['CREATED', 'WAITING_PLAYERS', 'ACTIVE'] } } } },
    },
    select: { id: true },
    take: 200,
  })
  if (stuck.length === 0) return 0
  const ids = stuck.map(c => c.id)
  const released = await prisma.character.updateMany({
    where: {
      id: { in: ids },
      status: 'IN_BATTLE',
      battlesAsParticipant: { none: { battle: { status: { in: ['CREATED', 'WAITING_PLAYERS', 'ACTIVE'] } } } },
    },
    data: { status: 'ACTIVE' },
  })
  audit('battle.cleanup.released', { characterIds: ids })
  return released.count
}
