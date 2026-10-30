import { BalanceConfig } from '../../config/balance.config'
import type { ItemBonuses } from './gear-bonuses'

export const ITEM_STAT_KEYS = ['DAMAGE', 'ACCURACY', 'CRIT', 'ARMOR', 'DURABILITY', 'ANTI_CRIT'] as const
export type ItemStatKey = typeof ITEM_STAT_KEYS[number]
export type ItemStatAllocation = Partial<Record<ItemStatKey, number>>
// Прочности среди очков вещи нет (правка заказчика 28.10: «прочность из доп
// характеристик убрать вообще, на всех вещах стандартно 100»). Ключ остался
// в ITEM_STAT_KEYS, чтобы старые записи читались, но вложить в него нельзя.
/** Сколько очков на вещи: её бюджет плюс очки за уровни именной вещи. */
export function itemBudget(template: { statBudget: number }, namedLevel: number): number {
  return template.statBudget + namedLevel * BalanceConfig.economy.namedItems.pointsPerLevel
}
/** Цена добавок в очках. Минус на стате не возвращает очки: иначе ненужный
 *  стат превращался бы в бесплатные очки для нужного. */
export function bonusCost(bonuses: ItemBonuses): number {
  const sum = (values: Record<string, number | undefined>) => Object.values(values).reduce<number>((total, value) => total + Math.abs(value ?? 0), 0)
  return sum(bonuses.stats) + sum(bonuses.mastery) + sum(bonuses.minusMastery) + sum(bonuses.charms) + sum(bonuses.minusCharms)
}
export function allowedItemStats(itemType: string): ItemStatKey[] {
  if (itemType === 'WEAPON') return ['DAMAGE', 'ACCURACY', 'CRIT']
  if (itemType === 'ARMOR' || itemType === 'SHIELD') return ['ARMOR', 'ANTI_CRIT']
  return []
}
export function normalizeAllocation(value: unknown): ItemStatAllocation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  return Object.fromEntries(ITEM_STAT_KEYS.flatMap(key => {
    const amount = source[key]
    return Number.isInteger(amount) && Number(amount) > 0 ? [[key, Number(amount)]] : []
  })) as ItemStatAllocation
}
export function allocatedPoints(value: unknown): number {
  return Object.values(normalizeAllocation(value)).reduce((sum, amount) => sum + (amount ?? 0), 0)
}
export function mergeAllocations(...values: unknown[]): ItemStatAllocation {
  const result: ItemStatAllocation = {}
  for (const value of values) for (const [key, amount] of Object.entries(normalizeAllocation(value)) as [ItemStatKey, number][]) result[key] = (result[key] ?? 0) + amount
  return result
}
