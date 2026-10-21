// Жилой сектор: стартовые числа (заказчик: «проценты любые пока»).
import type { HomeKind } from '@prisma/client'

export const HOUSING = {
  kinds: {
    APARTMENT: { name: 'Квартира', priceDollars: 40, expBonus: 0.05 },
    HOUSE: { name: 'Дом', priceDollars: 120, expBonus: 0.1 },
  } satisfies Record<HomeKind, { name: string; priceDollars: number; expBonus: number }>,
  tunnelPriceDollars: 15,
  /** Победа нападавшего снимает 10% прочности (заказчик). */
  raidDurabilityLoss: 10,
  /** Повторный налёт того же игрока на тот же дом — не раньше чем через сутки. */
  raidCooldownHours: 24,
  /** Как у Дома бригады: при 50% и ниже бонус дома выключен до ремонта. */
  bonusOffAtOrBelow: 50,
  repairCostPer10: 1000,
} as const

/**
 * Участки сектора (правка заказчика 21.10: «20–25 домов заранее, равномерно
 * на экране, игроки их покупают»): две многоэтажки по 8 квартир и ряд из
 * 8 частных домов. Номер участка задаёт вид жилья, свободных больше не станет.
 */
export const LOTS = { apartments: 16, houses: 8, flatsPerBlock: 8 } as const
export const LOT_COUNT = LOTS.apartments + LOTS.houses

export function lotKind(lot: number): HomeKind {
  return lot <= LOTS.apartments ? 'APARTMENT' : 'HOUSE'
}

/** «Кв. 5» / «Дом 3»: квартиры и дома нумеруются каждые с единицы. */
export function lotLabel(lot: number): string {
  return lotKind(lot) === 'APARTMENT' ? `Кв. ${lot}` : `Дом ${lot - LOTS.apartments}`
}

export function isLot(lot: number): boolean {
  return Number.isInteger(lot) && lot >= 1 && lot <= LOT_COUNT
}

export type TunnelCode = 'pvp' | 'industrial' | 'farm'
/** where — куда ведёт туннель, в падеже для кнопки: «Пройти на Стрелки». */
export const TUNNELS: { code: TunnelCode; label: string; where: string; to: string }[] = [
  { code: 'pvp', label: 'Стрелки', where: 'на Стрелки', to: '/pvp' },
  { code: 'industrial', label: 'Промзона', where: 'в Промзону', to: '/district/industrial' },
  { code: 'farm', label: 'Фермы', where: 'на Фермы', to: '/farm' },
]

export function homeBonusActive(durability: number): boolean {
  return durability > HOUSING.bonusOffAtOrBelow
}

export function homeExpBonus(kind: HomeKind, durability: number): number {
  return homeBonusActive(durability) ? HOUSING.kinds[kind].expBonus : 0
}
