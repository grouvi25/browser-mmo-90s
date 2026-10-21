import type { Prisma } from '@prisma/client'
import { BalanceConfig } from '../../config/balance.config'
import { calcHpMax, getLevelFromExp } from '../stats/stats.formulas'
import type { CharacterWithStats } from '../characters/characters.repository'
import { DOG_BREEDS, DOG_EXP_SHARE, dogLevelFromExp } from '../city/dogs'

export interface BattleProgressionResult {
  newExp: number
  newLevel: number
  levelsGained: number
  newHpMax: number
}

export async function applyBattleProgression(
  tx: Prisma.TransactionClient,
  char: CharacterWithStats,
  params: { expGain: number; hpCurrentAfterBattle: number; won: boolean },
): Promise<BattleProgressionResult> {
  const newExp = char.battleExp + params.expGain
  const newLevel = getLevelFromExp(newExp)
  const levelsGained = Math.max(0, newLevel - char.battleLevel)
  const newHpMax = calcHpMax(char.stats!.end, newLevel)

  await tx.character.update({
    where: { id: char.id },
    data: {
      battleExp: newExp,
      battleLevel: newLevel,
      hpMax: newHpMax,
      hpCurrent: Math.min(Math.max(1, params.hpCurrentAfterBattle), newHpMax),
      status: 'ACTIVE',
      battlesTotal: { increment: 1 },
      battlesWon: params.won ? { increment: 1 } : undefined,
      lastBattleFinishedAt: new Date(),
    },
  })

  if (levelsGained > 0) {
    await tx.characterStats.update({
      where: { characterId: char.id },
      data: {
        pointsAvailable: {
          increment: levelsGained * BalanceConfig.battleExp.statPointsPerLevel,
        },
      },
    })
  }

  // Сытая собака растёт вместе с хозяином: доля его боевого опыта
  // (правка заказчика 21.10 — у собак свои уровни и своя шкала опыта).
  if (params.expGain > 0) {
    const dog = await tx.characterPet.findFirst({
      where: { characterId: char.id, code: { in: DOG_BREEDS.map(b => b.code) }, fedUntil: { gt: new Date() } },
    })
    const gain = Math.floor(params.expGain * DOG_EXP_SHARE)
    if (dog && gain > 0) {
      const exp = dog.exp + gain
      await tx.characterPet.update({ where: { id: dog.id }, data: { exp, level: dogLevelFromExp(exp) } })
    }
  }

  return { newExp, newLevel, levelsGained, newHpMax }
}
