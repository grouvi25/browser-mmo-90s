export const ITEM_STAT_KEYS = ['DAMAGE', 'ACCURACY', 'CRIT', 'ARMOR', 'DURABILITY', 'ANTI_CRIT'] as const
export type ItemStatKey = typeof ITEM_STAT_KEYS[number]
export type ItemStatAllocation = Partial<Record<ItemStatKey, number>>
export function allowedItemStats(itemType: string): ItemStatKey[] {
  if (itemType === 'WEAPON') return ['DAMAGE', 'ACCURACY', 'CRIT', 'DURABILITY']
  if (itemType === 'ARMOR' || itemType === 'SHIELD') return ['ARMOR', 'DURABILITY', 'ANTI_CRIT']
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
