// =============================================================
// ТЕРРИТОРИИ — формулы Этапа 4
//
// Числа живут в BalanceConfig.strategy.territory, здесь только правила.
// Вывод чисел — docs/specs/stage-4/STAGE4_BALANCE.md раздел 1.
// =============================================================
import { BalanceConfig } from '../../config/balance.config'

const T = BalanceConfig.strategy.territory

/** Коды бонусов районов. Закрытый список: неизвестный код — ошибка сида. */
export const TERRITORY_BONUS_CODES = [
  'BATTLE_EXP', 'MARKET_SHARE', 'CYCLE_SPEED',
  'STORAGE_CAP', 'REPAIR_COST', 'UPKEEP_COST',
] as const
export type TerritoryBonusCode = (typeof TERRITORY_BONUS_CODES)[number]

export function isTerritoryBonusCode(value: string): value is TerritoryBonusCode {
  return (TERRITORY_BONUS_CODES as readonly string[]).includes(value)
}

/**
 * Подпись бонуса словами. Считает сервер, а не клиент: иначе фронт повторяет
 * таблицу бонусов и расходится с ней при первой правке баланса.
 */
export function bonusText(code: string, value: number): string {
  const pct = Math.round(value * 100)
  switch (code) {
    case 'BATTLE_EXP': return `+${pct}% к боевому опыту участников`
    case 'MARKET_SHARE': return `${pct}% рыночной комиссии района в общак`
    case 'CYCLE_SPEED': return `−${pct}% ко времени производственного цикла`
    case 'STORAGE_CAP': return `+${pct}% к вместимости складов объектов`
    case 'REPAIR_COST': return `−${pct}% к стоимости ремонта`
    case 'UPKEEP_COST': return `−${pct}% к содержанию клана и территорий`
    default: return ''
  }
}

/**
 * Содержание территории за сутки по её ступени.
 *
 * Ступень — порядковый номер территории у владельца, а не свойство района.
 * Вторая дороже первой в 2.5 раза: это главный ограничитель монополии, клан
 * на двух районах живёт впритык и третий не потянул бы, даже будь лимит выше.
 */
export function territoryUpkeepPerDay(tier: number): number {
  return tier <= 1 ? T.upkeepTier1 : T.upkeepTier2
}

/**
 * Суточный расход клана: своё содержание плюс все территории, со скидкой
 * Спального района на всю сумму.
 *
 * Скидка применяется здесь, а не к каждой территории отдельно, потому что
 * она распространяется и на содержание самого клана — посчитать её можно
 * только там, где известно и то и другое.
 */
export function clanDailyUpkeep(
  clanMaintenance: number,
  tiers: readonly number[],
  hasUpkeepDiscount: boolean,
  discountValue: number,
): number {
  const gross = clanMaintenance + tiers.reduce((sum, tier) => sum + territoryUpkeepPerDay(tier), 0)
  return Math.round(hasUpkeepDiscount ? gross * (1 - discountValue) : gross)
}

/**
 * Ступени по территориям одного клана.
 *
 * Порядок — по времени захвата: первая захваченная остаётся первой ступенью,
 * пока не потеряна. Иначе клан, взявший второй район, задним числом дорожал бы
 * по обоим и получал счёт за то, чего ещё не делал.
 */
export function assignTiers<T extends { id: string; controlledAt: Date | null }>(
  territories: readonly T[],
): Map<string, number> {
  const ordered = [...territories].sort((a, b) => {
    const left = a.controlledAt?.getTime() ?? 0
    const right = b.controlledAt?.getTime() ?? 0
    if (left !== right) return left - right
    // Захваты в одну миллисекунду возможны только в тестах и в сиде;
    // id даёт устойчивый порядок, чтобы ступени не прыгали между прогонами.
    return a.id.localeCompare(b.id)
  })
  return new Map(ordered.map((territory, index) => [territory.id, index + 1]))
}

/** Долг дорос до отключения бонуса, но район ещё у клана. */
export function isBonusSuspended(upkeepDebt: number): boolean {
  return upkeepDebt >= T.upkeepDebtBonusOff
}

/** Долг дорос до потери района. */
export function shouldRelease(upkeepDebt: number): boolean {
  return upkeepDebt >= T.upkeepDebtRelease
}

/** Защита после захвата ещё действует. */
export function isProtected(protectedUntil: Date | null, now = new Date()): boolean {
  return !!protectedUntil && protectedUntil.getTime() > now.getTime()
}

export const TERRITORY_LIMIT = T.limit
export const TERRITORY_PROTECTION_HOURS = T.protectionHours
