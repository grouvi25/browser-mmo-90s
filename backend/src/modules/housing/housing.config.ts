// Жилой сектор: стартовые числа (заказчик: «проценты любые пока»).
import type { HomeKind } from '@prisma/client'

export const HOUSING = {
  kinds: {
    APARTMENT: { name: 'Квартира', priceDollars: 40, expBonus: 0.05 },
    HOUSE: { name: 'Дом', priceDollars: 120, expBonus: 0.1 },
  } satisfies Record<HomeKind, { name: string; priceDollars: number; expBonus: number }>,
  tunnelPriceDollars: 15,
  /** Победа нападавших снимает 10% прочности (заказчик). */
  raidDurabilityLoss: 10,
  /**
   * Налёт — как осада дома бригады (правка заказчика 22.10): заявка, бой
   * ровно через 72 часа, до 10 человек в нападение и до 10 в оборону; на
   * один дом — раз в неделю.
   */
  raidLeadHours: 72,
  raidMaxPerSide: 10,
  raidCooldownDays: 7,
  /** Как у Дома бригады: при 50% и ниже бонус дома выключен до ремонта. */
  bonusOffAtOrBelow: 50,
  repairCostPer10: 1000,
  /**
   * Склад в жилье (правка 22.10): «квартиры дают только опыт + место для
   * склада, а дом ещё возможность постройки туннелей». Ящик — один вид
   * ресурса, до boxCapacity штук. Числа стартовые.
   */
  storage: {
    boxes: { APARTMENT: 10, HOUSE: 20 } satisfies Record<HomeKind, number>,
    boxCapacity: 100,
  },
  /** Туннели можно прорыть только из дома, не из квартиры. */
  tunnelKinds: ['HOUSE'] as HomeKind[],
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
/**
 * where — куда ведёт туннель, в падеже для кнопки: «Пройти на Стрелки».
 * area — адреса этого места: пока хозяин ходит по ним, он может вернуться
 * в дом тем же туннелем (правка заказчика 22.10); ушёл другой дорогой —
 * обратного хода нет.
 */
export const TUNNELS: { code: TunnelCode; label: string; where: string; to: string; area: string[] }[] = [
  { code: 'pvp', label: 'Стрелки', where: 'на Стрелки', to: '/pvp', area: ['/pvp', '/battles', '/battle'] },
  { code: 'industrial', label: 'Промзона', where: 'в Промзону', to: '/district/industrial', area: ['/district/industrial', '/work', '/objects', '/recipes'] },
  { code: 'farm', label: 'Фермы', where: 'на Фермы', to: '/farm', area: ['/farm', '/plants'] },
]

const within = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?')

/** Остался ли хозяин в месте, куда вышел туннелем. */
export function insideTunnelArea(code: string | null | undefined, path: string): boolean {
  const tunnel = TUNNELS.find(t => t.code === code)
  return !!tunnel && tunnel.area.some(prefix => within(path, prefix))
}

export function homeBonusActive(durability: number): boolean {
  return durability > HOUSING.bonusOffAtOrBelow
}

export function homeExpBonus(kind: HomeKind, durability: number): number {
  return homeBonusActive(durability) ? HOUSING.kinds[kind].expBonus : 0
}

/** Защита новичков: на игроков ниже этого боевого уровня не нападают. */
export const NEWBIE_PROTECTION_LEVEL = 3
