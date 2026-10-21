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

export type TunnelCode = 'pvp' | 'industrial' | 'farm'
export const TUNNELS: { code: TunnelCode; label: string; to: string }[] = [
  { code: 'pvp', label: 'Стрелки', to: '/pvp' },
  { code: 'industrial', label: 'Промзона', to: '/district/industrial' },
  { code: 'farm', label: 'Фермы', to: '/farm' },
]

export function homeBonusActive(durability: number): boolean {
  return durability > HOUSING.bonusOffAtOrBelow
}

export function homeExpBonus(kind: HomeKind, durability: number): number {
  return homeBonusActive(durability) ? HOUSING.kinds[kind].expBonus : 0
}
