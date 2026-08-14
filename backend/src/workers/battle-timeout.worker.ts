/**
 * Battle Timeout Worker — Этап 1.5
 *
 * Каждые 2 секунды проверяет активные бои.
 * Если игрок не сделал ход за 60 секунд (roundDeadline) → авто-блок.
 *
 * Используется BattleRedis (Redis) + прямой вызов BattleService.submitAction
 * от имени «системы».
 */

import { prisma } from '../shared/db/prisma'
import { BattleRedis } from '../shared/db/redis'
import { BattleService, type LiveBattleState } from '../modules/battles/battles.service'
import { timedOutCharacterIds } from '../modules/battles/battle-timeout'
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
      if (!state) continue
      const timeoutRound = state.roundNumber
      const pendingCharacterIds = timedOutCharacterIds(state, now)
      for (const characterId of pendingCharacterIds) {
        // A previous auto-turn may have resolved the round. Never submit a stale
        // timeout action into the next round.
        const currentState = await BattleRedis.getState<LiveBattleState>(battleId)
        if (!currentState || currentState.status !== 'active' || currentState.roundNumber !== timeoutRound) break
        const currentParticipant = currentState.participants.find(participant => participant.characterId === characterId)
        if (!currentParticipant?.isAlive || currentParticipant.isSurrendered || currentParticipant.hasActedThisRound) continue

        const char = await prisma.character.findUnique({
          where: { id: characterId },
          select: { userId: true, nickname: true },
        })
        if (!char) continue

        logger.info({
          battleId, characterId, round: timeoutRound,
        }, '[BattleTimeout] Auto-defense for timeout')

        await BattleService.submitAction(char.userId, battleId, {
          action: 'block',
          stance: 'defense4',
          attackZones: [],
          blockZones: ['HEAD', 'CHEST', 'LEGS', 'RIGHT_ARM'],
        })
      }

    } catch (err) {
      // Тихо логируем — не прерываем цикл
      logger.debug({ err, battleId }, '[BattleTimeout] Error in battle timeout check')
    }
  }
}
