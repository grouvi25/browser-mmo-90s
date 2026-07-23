/**
 * Battle Timeout Worker — Этап 1.5
 *
 * Каждые 2 секунды проверяет активные бои.
 * Если игрок не сделал ход за 7 секунд (roundDeadline) → авто-блок.
 *
 * Используется BattleRedis (Redis) + прямой вызов BattleService.submitAction
 * от имени «системы».
 */

import { prisma } from '../shared/db/prisma'
import { BattleRedis } from '../shared/db/redis'
import { BattleService, type LiveBattleState } from '../modules/battles/battles.service'
import { logger } from '../shared/logger/logger'

export const TIMER_TICK_MS = 2_000 // проверяем каждые 2 секунды

export async function runBattleTimeout(): Promise<void> {
  const now = Date.now()

  // Берём все активные бои из Redis
  // Оптимизация: храним список активных battleId в отдельном Redis Set
  // Пока — запрашиваем из БД (приемлемо при малом кол-ве боёв)
  const activeBattles = await prisma.battle.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
    take: 200,
  })

  for (const { id: battleId } of activeBattles) {
    try {
      const state = await BattleRedis.getState<LiveBattleState>(battleId)
      if (!state || state.status !== 'active') continue
      if (!state.roundDeadline) continue
      if (now < state.roundDeadline) continue // время не вышло

      // Находим игрока который ещё не сделал ход
      const pendingPlayer = state.participants.find(
        p => p.characterId && p.isAlive && !p.hasActedThisRound
      )
      if (!pendingPlayer || !pendingPlayer.characterId) continue

      // Ищем userId по characterId
      const char = await prisma.character.findUnique({
        where: { id: pendingPlayer.characterId },
        select: { userId: true, nickname: true },
      })
      if (!char) continue

      logger.info({
        battleId, characterId: pendingPlayer.characterId, round: state.roundNumber,
      }, '[BattleTimeout] Auto-block for timeout')

      // Авто-блок от имени игрока
      await BattleService.submitAction(char.userId, battleId, 'block')

    } catch (err) {
      // Тихо логируем — не прерываем цикл
      logger.debug({ err, battleId }, '[BattleTimeout] Error in battle timeout check')
    }
  }
}
