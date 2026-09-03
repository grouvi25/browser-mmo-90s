import type { ItemQuality, ResourceQuality } from '@prisma/client'
import { BalanceConfig } from '../../config/balance.config'

const config = BalanceConfig.economy.production
const qualityOrder: ResourceQuality[] = ['POOR', 'NORMAL', 'FINE']

export function laborFromShift(shiftDurationMinutes: number, workerEfficiency: number): number {
  return Math.round(shiftDurationMinutes * workerEfficiency)
}

/**
 * Длительность цикла.
 *
 * `districtSpeedBonus` — бонус CYCLE_SPEED Промзоны, доля от 0 до 1. Он
 * складывается с бонусом инструмента в общий делитель, а не режет время
 * отдельным множителем: иначе два ускорения перемножались бы, и владелец
 * Промзоны с хорошим инструментом закрывал бы цикл вдвое быстрее коридора.
 */
export function cycleDurationMinutes(
  baseMinutes: number,
  toolTier: number,
  requiredToolTier: number,
  districtSpeedBonus = 0,
): number {
  const toolBonus = Math.max(0, toolTier - requiredToolTier) * config.equipmentTierSpeedBonus
  const district = Math.max(0, Math.min(1, districtSpeedBonus))
  return Math.max(1, Math.round(baseMinutes / (1 + toolBonus + district)))
}

export function cycleReady(params: {
  laborAccumulated: number
  laborRequired: number
  endsAt: Date | null
  now: Date
}): boolean {
  return params.laborAccumulated >= params.laborRequired
    && params.endsAt !== null
    && params.endsAt <= params.now
}

export function outputQuality(params: {
  professionLevel: number
  toolTier: number
  requiredToolTier: number
  minInputQuality: ResourceQuality | null
}): ResourceQuality {
  const inputBonus = params.minInputQuality === 'POOR'
    ? -1
    : params.minInputQuality === 'FINE' ? 1 : 0
  const score = params.professionLevel * 0.5
    + (params.toolTier - params.requiredToolTier)
    + inputBonus
  if (score < 0) return 'POOR'
  if (score >= 3) return 'FINE'
  return 'NORMAL'
}

export function isQualityAtLeast(actual: ResourceQuality, required: ResourceQuality): boolean {
  return qualityOrder.indexOf(actual) >= qualityOrder.indexOf(required)
}

export function resourceToItemQuality(quality: ResourceQuality): ItemQuality {
  if (quality === 'POOR') return 'JUNK'
  if (quality === 'FINE') return 'GOOD'
  return 'COMMON'
}

export function equipmentWear(): number {
  return config.equipmentWearPerCycle
}
