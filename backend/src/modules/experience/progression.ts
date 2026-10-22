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

  await warnWornGear(tx, char.id)

  return { newExp, newLevel, levelsGained, newHpMax }
}

/** Порог предупреждения об износе: доля от полной прочности. */
export const WEAR_WARN_SHARE = 0.2

/** После боя — строка в чат о вещи, которая вот-вот сломается (обещание
 *  игрокам 22.10). Про одну вещь — не чаще раза в сутки. */
async function warnWornGear(tx: Prisma.TransactionClient, characterId: string): Promise<void> {
  const items = await tx.itemInstance.findMany({
    where: { ownerId: characterId, isEquipped: true, status: { not: 'DELETED' } },
    select: { durabilityCurrent: true, durabilityMax: true, template: { select: { name: true } } },
  })
  const since = new Date(Date.now() - 24 * 3_600_000)
  for (const item of items) {
    if (item.durabilityMax <= 0 || item.durabilityCurrent > item.durabilityMax * WEAR_WARN_SHARE) continue
    const text = item.durabilityCurrent <= 0
      ? `Вещь «${item.template.name}» сломана и не работает — почините в Гаражах.`
      : `Вещь «${item.template.name}» почти сломана: прочность ${item.durabilityCurrent}/${item.durabilityMax}. Почините в Гаражах.`
    const sent = await tx.gameNotice.findFirst({ where: { characterId, text: { startsWith: `Вещь «${item.template.name}» ` }, createdAt: { gte: since } }, select: { id: true } })
    if (!sent) await tx.gameNotice.create({ data: { characterId, text } })
  }
}
