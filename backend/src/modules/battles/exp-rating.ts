// №114 (Amadeus 14.11): опыт зависит от того, насколько ты сильнее цели.
// Рейтинг для этого — со всем надетым: статы вместе с прибавками вещей,
// урон и броня вещей, обереги и мастерства (очками: 5% = 1 очко).
import { BalanceConfig } from '../../config/balance.config'
import { prisma } from '../../shared/db/prisma'
import { calcCharacterRating, type calcEquippedItemRating } from '../stats/stats.formulas'
import { CHARM_KEYS, MASTERY_KEYS, gearOf, withGearStats } from '../items/gear-bonuses'

type Stats = { str: number; agi: number; rea: number; acc: number; end: number; luck: number; agr: number; aluck?: number }
type Equipped = Parameters<typeof gearOf>[0][number] & Parameters<typeof calcEquippedItemRating>[0]

export function combatRating(stats: Stats, equipped: Equipped[]): number {
  const gear = gearOf(equipped)
  const per = BalanceConfig.economy.namedItems.percentPerPoint / 100
  const charms = CHARM_KEYS.reduce((sum, key) => sum + gear[key] + gear.minus[key], 0)
  const mastery = MASTERY_KEYS.reduce((sum, key) => sum + (gear.mastery[key] ?? 0) + (gear.minusMastery[key] ?? 0), 0)
  return calcCharacterRating(withGearStats(stats, gear), equipped) + (charms + mastery) / per
}

const CACHE_MS = 10 * 60_000
const levelCache = new Map<number, { at: number; value: number | null }>()

/** Средний (медианный) рейтинг игроков этого уровня ±1, активных за 2 недели.
 *  Мало игроков — null, тогда опыт не трогаем. */
export async function typicalRatingForLevel(level: number): Promise<number | null> {
  const hit = levelCache.get(level)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  const since = new Date(Date.now() - 14 * 24 * 3600_000)
  const chars = await prisma.character.findMany({
    where: { battleLevel: { gte: level - 1, lte: level + 1 }, lastActiveAt: { gte: since } },
    select: { stats: true, items: { where: { isEquipped: true, status: { not: 'DELETED' } }, include: { template: true } } },
    take: 200,
  })
  const ratings = chars.filter(c => c.stats).map(c => combatRating(c.stats!, c.items)).sort((a, b) => a - b)
  const value = ratings.length >= 3 ? ratings[Math.floor(ratings.length / 2)] : null
  levelCache.set(level, { at: Date.now(), value })
  return value
}
