// =============================================================
// Что надетое добавляет персонажу (правка заказчика 26.10):
//   • характеристики — сила, выносливость, фарт (удача), ловкость,
//     меткость (точность), агрессия;
//   • обереги в процентах — уворота, удачи, крита, ответа. Они бывают и в
//     плюс, и в минус;
//   • здоровье.
//
// Обереги в движке боя уже были (как в «Апехе»), но считались кусками:
// уворот и ответ — только с оружия, удача и крит — только с брони, и амулет
// с оберегом ничего не давал. Теперь — сумма по всему надетому.
// =============================================================
import type { Prisma } from '@prisma/client'
import { calcHpMax } from '../stats/stats.formulas'

export const GEAR_STAT_KEYS = ['str', 'end', 'luck', 'agi', 'acc', 'agr'] as const
export type GearStatKey = typeof GEAR_STAT_KEYS[number]
export type GearStats = Record<GearStatKey, number>

/** Предел одной прибавки к характеристике с одной вещи. */
export const GEAR_STAT_LIMIT = 50

export interface GearBonuses {
  stats: GearStats
  /** Оберег уворота: срезает уворот противника. */
  antiDodge: number
  /** Оберег удачи: срезает удачу (удачный удар) противника. */
  antiLuck: number
  /** Оберег крита: срезает крит противника. */
  antiCrit: number
  /** Оберег ответа: срезает ответку противника. */
  antiCounter: number
  /** Прибавка к здоровью. */
  hp: number
}

type TemplateLike = {
  type?: string
  statBonuses?: unknown
  antiDodge?: number | null
  antiLuck?: number | null
  antiCrit?: number | null
  antiCounter?: number | null
  hpBonus?: number | null
}
type ItemLike = { id: string; durabilityCurrent?: number; template: TemplateLike } | null | undefined

const zeroStats = (): GearStats => ({ str: 0, end: 0, luck: 0, agi: 0, acc: 0, agr: 0 })

export const EMPTY_GEAR: GearBonuses = Object.freeze({ stats: Object.freeze(zeroStats()), antiDodge: 0, antiLuck: 0, antiCrit: 0, antiCounter: 0, hp: 0 }) as GearBonuses

/** Прибавки вещи к характеристикам из базы: только известные ключи, целые, в пределах. */
export function normalizeStatBonuses(value: unknown): Partial<GearStats> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  return Object.fromEntries(GEAR_STAT_KEYS.flatMap(key => {
    const amount = source[key]
    if (!Number.isInteger(amount) || amount === 0) return []
    return [[key, Math.max(-GEAR_STAT_LIMIT, Math.min(GEAR_STAT_LIMIT, Number(amount)))]]
  })) as Partial<GearStats>
}

/**
 * Сумма по надетому. Расходники не в счёт (их hpBonus — лечение, а не
 * здоровье); сломанная вещь ничего не даёт; одна и та же вещь, переданная
 * дважды (оружие в обеих руках списком), считается один раз.
 */
export function gearOf(items: ItemLike[]): GearBonuses {
  const gear: GearBonuses = { stats: zeroStats(), antiDodge: 0, antiLuck: 0, antiCrit: 0, antiCounter: 0, hp: 0 }
  const seen = new Set<string>()
  for (const item of items) {
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    const t = item.template
    if (t.type === 'CONSUMABLE' || t.type === 'TOOL' || t.type === 'RESOURCE') continue
    if (item.durabilityCurrent !== undefined && item.durabilityCurrent <= 0) continue
    for (const [key, amount] of Object.entries(normalizeStatBonuses(t.statBonuses)) as [GearStatKey, number][]) {
      gear.stats[key] += amount
    }
    gear.antiDodge += t.antiDodge ?? 0
    gear.antiLuck += t.antiLuck ?? 0
    gear.antiCrit += t.antiCrit ?? 0
    gear.antiCounter += t.antiCounter ?? 0
    gear.hp += t.hpBonus ?? 0
  }
  return gear
}

/** Характеристики персонажа с прибавками от надетого; ниже нуля не уходят. */
export function withGearStats<T extends Partial<Record<GearStatKey, number>>>(stats: T, gear: GearBonuses): T {
  const out = { ...stats }
  for (const key of GEAR_STAT_KEYS) {
    if (typeof out[key] === 'number') (out as Record<string, number>)[key] = Math.max(0, (out[key] as number) + gear.stats[key])
  }
  return out
}

/** Прибавки от всего, что сейчас надето на персонажа. */
export async function gearFor(tx: Prisma.TransactionClient, characterId: string): Promise<GearBonuses> {
  const equipped = await tx.itemInstance.findMany({
    where: { ownerId: characterId, isEquipped: true, status: { notIn: ['BROKEN', 'DELETED', 'CONSUMED'] } },
    select: { id: true, durabilityCurrent: true, template: { select: { type: true, statBonuses: true, antiDodge: true, antiLuck: true, antiCrit: true, antiCounter: true, hpBonus: true } } },
  })
  return gearOf(equipped)
}

/**
 * Пересчитать здоровье персонажа под надетое: выносливость и здоровье
 * с вещей поднимают максимум. Текущее здоровье не растёт само (лечится со
 * временем), но и не превышает новый максимум.
 */
export async function syncHpWithGear(tx: Prisma.TransactionClient, characterId: string): Promise<{ hpMax: number; hpCurrent: number } | null> {
  const char = await tx.character.findUnique({
    where: { id: characterId },
    select: { battleLevel: true, hpCurrent: true, hpMax: true, stats: { select: { end: true } } },
  })
  if (!char?.stats) return null
  const gear = await gearFor(tx, characterId)
  const hpMax = calcHpMax(Math.max(0, char.stats.end + gear.stats.end), char.battleLevel, gear.hp)
  const hpCurrent = Math.min(char.hpCurrent, hpMax)
  if (hpMax !== char.hpMax || hpCurrent !== char.hpCurrent) {
    await tx.character.update({ where: { id: characterId }, data: { hpMax, hpCurrent } })
  }
  return { hpMax, hpCurrent }
}
