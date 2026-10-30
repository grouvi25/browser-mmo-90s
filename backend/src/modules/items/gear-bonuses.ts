// =============================================================
// Что надетое добавляет персонажу (правка заказчика 26.10):
//   • характеристики — сила, выносливость, фарт (удача), ловкость,
//     меткость (точность), агрессия;
//   • обереги в процентах — уворота, удачи, крита, ответа. Они бывают и в
//     плюс, и в минус;
//   • здоровье.
//
// Плюс и минус оберега — по правилу «5 королей» и «Апехи» (их библиотека:
// «баланс оберегов между двумя персонажами складывается из положительного
// оберега одного персонажа и отрицательного оберега второго»; «отрицательные
// обереги работают на понижение соответствующего оберега у противника»).
// Плюс на вещи — свой оберег. Минус — не уменьшает свой, а срезает тот же
// оберег у противника: так обереги противника перестают действовать.
// В бою оберег = свой плюс − минус противника, не ниже нуля.
//
// Обереги в движке боя уже были (как в «Апехе»), но считались кусками:
// уворот и ответ — только с оружия, удача и крит — только с брони, и амулет
// с оберегом ничего не давал. Теперь — сумма по всему надетому.
//
// Правка 31.10 (образец заказчика — «Примерочная» клана «Инквизиция»): на
// одной вещи оберег бывает сразу и в плюс, и в минус, поэтому минус-обереги
// получили своё место, а рядом — мастерства и минус-мастерства. Всего
// 23 параметра: 7 статов и по 4 в каждой из четырёх групп. Мастерства:
//   • кулачный бой — прибавка к урону рукопашной и голыми руками;
//   • исп. оружия — прибавка к урону любым другим оружием;
//   • защита — насколько меньше урона проходит по вам;
//   • меткость — прибавка к точности.
// Минус-мастерство срезает то же мастерство у противника, как минус-оберег.
// =============================================================
import type { Prisma } from '@prisma/client'
import { calcHpMax } from '../stats/stats.formulas'

export const GEAR_STAT_KEYS = ['str', 'end', 'luck', 'agi', 'acc', 'agr', 'rea'] as const
export type GearStatKey = typeof GEAR_STAT_KEYS[number]
export type GearStats = Record<GearStatKey, number>

/** Предел одной прибавки к характеристике с одной вещи. */
export const GEAR_STAT_LIMIT = 50

export type CharmKey = 'antiDodge' | 'antiLuck' | 'antiCrit' | 'antiCounter'
export const CHARM_KEYS: CharmKey[] = ['antiDodge', 'antiLuck', 'antiCrit', 'antiCounter']

export type MasteryKey = 'fist' | 'defense' | 'weapon' | 'accuracy'
export const MASTERY_KEYS: MasteryKey[] = ['fist', 'defense', 'weapon', 'accuracy']

/** Потолки в бою: урон мастерством не больше чем вдвое, защита — не больше половины. */
export const MASTERY_DAMAGE_CAP = 1
export const MASTERY_DEFENSE_CAP = 0.5

/** Что записано на вещи сверх базовых колонок. Проценты: 5 = 5%. */
export interface ItemBonuses {
  stats: Partial<GearStats>
  mastery: Partial<Record<MasteryKey, number>>
  minusMastery: Partial<Record<MasteryKey, number>>
  charms: Partial<Record<CharmKey, number>>
  minusCharms: Partial<Record<CharmKey, number>>
}

export interface GearBonuses {
  stats: GearStats
  /** Минус-обереги: на сколько срезать тот же оберег у противника (доли, ≥ 0). */
  minus: Record<CharmKey, number>
  /** Мастерства (доли, ≥ 0). */
  mastery: Record<MasteryKey, number>
  /** Минус-мастерства: на сколько срезать то же мастерство у противника. */
  minusMastery: Record<MasteryKey, number>
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
  extraBonuses?: unknown
  antiDodge?: number | null
  antiLuck?: number | null
  antiCrit?: number | null
  antiCounter?: number | null
  hpBonus?: number | null
}
type ItemLike = { id: string; durabilityCurrent?: number; bonuses?: unknown; template: TemplateLike } | null | undefined

const zeroStats = (): GearStats => ({ str: 0, end: 0, luck: 0, agi: 0, acc: 0, agr: 0, rea: 0 })
const zeroCharms = (): Record<CharmKey, number> => ({ antiDodge: 0, antiLuck: 0, antiCrit: 0, antiCounter: 0 })
const zeroMastery = (): Record<MasteryKey, number> => ({ fist: 0, defense: 0, weapon: 0, accuracy: 0 })

export const EMPTY_GEAR: GearBonuses = Object.freeze({ stats: Object.freeze(zeroStats()), minus: Object.freeze(zeroCharms()), mastery: Object.freeze(zeroMastery()), minusMastery: Object.freeze(zeroMastery()), antiDodge: 0, antiLuck: 0, antiCrit: 0, antiCounter: 0, hp: 0 }) as GearBonuses

/** Оберег в бою: свой плюс минус минус-оберег противника, не ниже нуля. */
export function charmBalance(own: number, opponentMinus: number): number {
  return Math.max(0, own - opponentMinus)
}

/** Мастерство в бою: своё минус минус-мастерство противника, не ниже нуля. */
export function masteryBalance(own: GearBonuses, opponent: GearBonuses, key: MasteryKey): number {
  return charmBalance(own.mastery[key], opponent.minusMastery[key])
}

/** Проценты из базы: только известные ключи, положительные, не больше 100. */
function readPercents<K extends string>(value: unknown, keys: readonly K[]): Partial<Record<K, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  return Object.fromEntries(keys.flatMap(key => {
    const amount = Number(source[key])
    return Number.isFinite(amount) && amount > 0 ? [[key, Math.min(100, amount)]] : []
  })) as Partial<Record<K, number>>
}

/** Добавки вещи из JSON: всё лишнее и битое отбрасывается. */
export function readItemBonuses(value: unknown): ItemBonuses {
  const source = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  return {
    stats: normalizeStatBonuses(source.stats),
    mastery: readPercents(source.mastery, MASTERY_KEYS),
    minusMastery: readPercents(source.minusMastery, MASTERY_KEYS),
    charms: readPercents(source.charms, CHARM_KEYS),
    minusCharms: readPercents(source.minusCharms, CHARM_KEYS),
  }
}

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
  const gear: GearBonuses = { stats: zeroStats(), minus: zeroCharms(), mastery: zeroMastery(), minusMastery: zeroMastery(), antiDodge: 0, antiLuck: 0, antiCrit: 0, antiCounter: 0, hp: 0 }
  const add = (bonuses: ItemBonuses) => {
    for (const [key, amount] of Object.entries(bonuses.stats) as [GearStatKey, number][]) gear.stats[key] += amount
    for (const key of CHARM_KEYS) {
      gear[key] += (bonuses.charms[key] ?? 0) / 100
      gear.minus[key] += (bonuses.minusCharms[key] ?? 0) / 100
    }
    for (const key of MASTERY_KEYS) {
      gear.mastery[key] += (bonuses.mastery[key] ?? 0) / 100
      gear.minusMastery[key] += (bonuses.minusMastery[key] ?? 0) / 100
    }
  }
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
    // Плюс — в свой оберег, минус — в минус-оберег против противника.
    for (const key of CHARM_KEYS) {
      const value = t[key] ?? 0
      if (value > 0) gear[key] += value
      else if (value < 0) gear.minus[key] += -value
    }
    gear.hp += t.hpBonus ?? 0
    add(readItemBonuses(t.extraBonuses))
    add(readItemBonuses(item.bonuses))
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
    select: { id: true, durabilityCurrent: true, bonuses: true, template: { select: { type: true, statBonuses: true, extraBonuses: true, antiDodge: true, antiLuck: true, antiCrit: true, antiCounter: true, hpBonus: true } } },
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
