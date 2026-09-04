export const FARM_MAX_PLOTS = 12
export const FARM_MAX_WATERS = 3
export const FARM_WATER_COOLDOWN_MINUTES = 20
export const FARM_WITHER_BASE_HOURS = 6

export const CROPS = {
  dill: { name: 'Укроп', minutes: 15, yieldMin: 2, yieldMax: 3, seedPrice: 20, resourceCode: 'res_greens', requiredLevel: 0 },
  // yieldMin/Max подняты с 3-5 (04.09.2026): при честном расчёте (одна
  // грядка — только она бесплатна новичку, см. STAGE5_FULL_RUN_REPORT.md)
  // старый выход давал 32% от смены вместо коридора 60-80%. Цену
  // res_vegetables не трогаем — её же берут госскупка, колхоз и бар.
  potato: { name: 'Картошка', minutes: 45, yieldMin: 5, yieldMax: 7, seedPrice: 45, resourceCode: 'res_vegetables', requiredLevel: 0 },
  hops: { name: 'Хмель', minutes: 90, yieldMin: 2, yieldMax: 4, seedPrice: 110, resourceCode: 'res_hops', requiredLevel: 1 },
  sunflower: { name: 'Подсолнух', minutes: 150, yieldMin: 2, yieldMax: 3, seedPrice: 200, resourceCode: 'res_seeds', requiredLevel: 2 },
  tobacco: { name: 'Табак', minutes: 240, yieldMin: 1, yieldMax: 2, seedPrice: 380, resourceCode: 'res_tobacco', requiredLevel: 3 },
} as const

export type CropCode = keyof typeof CROPS

export const FARM_BUILDINGS = {
  BARREL: { name: 'Бочка', price: 2500 },
  CANOPY: { name: 'Навес', price: 5000 },
  CELLAR: { name: 'Погреб', price: 8000 },
  DOG: { name: 'Собака', price: 15000 },
} as const

export type FarmBuildingCode = keyof typeof FARM_BUILDINGS

export function adjacentSlots(slot: number): number[] {
  const result: number[] = []
  if ((slot - 1) % 4 !== 0) result.push(slot - 1)
  if (slot % 4 !== 0) result.push(slot + 1)
  return result.filter(value => value >= 1 && value <= FARM_MAX_PLOTS)
}

export function applyBuildingBonuses(readyAt: Date, now: Date, hasBarrel: boolean, hasCanopy: boolean) {
  let result = readyAt
  let waterCount = 0
  if (hasBarrel) { result = wateredReadyAt(result, now); waterCount = 1 }
  if (hasCanopy) result = wateredReadyAt(result, now)
  return { readyAt: result, waterCount }
}

export function plotPrice(slot: number): number {
  if (slot === 1) return 0
  if (slot <= 3) return 1500
  if (slot <= 6) return 4000
  if (slot <= 9) return 9000
  if (slot <= 12) return 18000
  throw new Error('Farm plot limit exceeded')
}

export function initialFarmTimers(crop: CropCode, professionLevel: number, now = new Date()) {
  const readyAt = new Date(now.getTime() + CROPS[crop].minutes * 60_000)
  const withersAt = new Date(readyAt.getTime() + (FARM_WITHER_BASE_HOURS + Math.max(0, professionLevel)) * 3_600_000)
  return { plantedAt: now, readyAt, withersAt }
}

export function wateredReadyAt(readyAt: Date, now = new Date()): Date {
  const remaining = Math.max(0, readyAt.getTime() - now.getTime())
  return new Date(now.getTime() + Math.round(remaining * 0.9))
}

export function harvestAmount(crop: CropCode, roll = Math.random()): number {
  const item = CROPS[crop]
  return item.yieldMin + Math.floor(Math.min(0.999999, Math.max(0, roll)) * (item.yieldMax - item.yieldMin + 1))
}
