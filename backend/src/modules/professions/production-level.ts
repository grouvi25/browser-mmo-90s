// Производственный уровень (№128, Metallica 16.11; Дима 15.11 «делаем»).
// Опыт копится со всех профессий сразу: смены, крафт в цехах, урожай. Уровень
// не падает. За каждый новый — выносливость и премия, раз в shiftEveryLevels
// уровней — лишняя смена в день. Награда выдаётся по разу, в той же транзакции.
import type { Prisma } from '@prisma/client'
import { BalanceConfig } from '../../config/balance.config'
import { EconomyService } from '../economy/economy.service'
import { syncHpWithGear } from '../items/gear-bonuses'

const P = BalanceConfig.productionLevel

export function productionLevelFromExp(exp: number): number {
  let level = 0
  for (let i = 1; i < P.levelThresholds.length; i++) if (exp >= P.levelThresholds[i]) level = i
  return level
}

/** Лишние смены в день от производственного уровня. */
export function productionShiftBonus(level: number): number {
  return P.shiftEveryLevels > 0 ? Math.floor(Math.max(0, level) / P.shiftEveryLevels) : 0
}

export function productionLevelBounds(level: number): { from: number; next: number | null } {
  return { from: P.levelThresholds[level] ?? 0, next: P.levelThresholds[level + 1] ?? null }
}

/**
 * Начислить производственный опыт. gain = 0 только пересчитывает уровень по
 * уже накопленному опыту (догоняющая выдача после ввода уровня).
 */
export async function grantProductionExp(tx: Prisma.TransactionClient, characterId: string, gain: number) {
  const gainInt = Math.max(0, Math.floor(gain))
  const before = await tx.character.findUniqueOrThrow({ where: { id: characterId }, select: { productionExp: true, productionLevel: true } })
  const productionExp = before.productionExp + gainInt
  const level = Math.max(before.productionLevel, productionLevelFromExp(productionExp))
  const gained = level - before.productionLevel
  await tx.character.update({ where: { id: characterId }, data: { productionExp, productionLevel: level } })
  if (gained <= 0) return { productionExp, productionLevel: level, levelsGained: 0 }

  const end = gained * P.endPerLevel
  if (end > 0) await tx.characterStats.update({ where: { characterId }, data: { end: { increment: end } } })
  const money = gained * P.levelMoney
  if (money > 0) {
    await EconomyService.credit(tx, { characterId, amount: money, reasonCode: 'LEVEL_BONUS', refType: 'production_level', note: `Производственный уровень ${level}` })
  }
  const shifts = productionShiftBonus(level) - productionShiftBonus(before.productionLevel)
  // Выносливость поднимает здоровье: пересчёт с надетым, как после боя.
  if (end > 0) await syncHpWithGear(tx, characterId)
  const parts = [end > 0 ? `+${end} к выносливости` : '', money > 0 ? `+${money.toLocaleString('ru-RU')} ₽` : '', shifts > 0 ? `+${shifts} ${shifts === 1 ? 'смена' : 'смены'} в день` : ''].filter(Boolean)
  await tx.gameNotice.create({ data: { characterId, text: `Новый производственный уровень ${level}${parts.length ? `: ${parts.join(', ')}` : ''}.` } })
  return { productionExp, productionLevel: level, levelsGained: gained }
}
