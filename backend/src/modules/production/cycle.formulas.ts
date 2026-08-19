import type { ResourceQuality } from '@prisma/client'
import { BalanceConfig } from '../../config/balance.config'

const config = BalanceConfig.economy.production
const qualityOrder: ResourceQuality[] = ['POOR', 'NORMAL', 'FINE']

export function laborFromShift(shiftDurationMinutes: number, workerEfficiency: number): number {
  return Math.round(shiftDurationMinutes * workerEfficiency)
}

export function cycleDurationMinutes(baseMinutes: number, toolTier: number, requiredToolTier: number): number {
  const bonus = Math.max(0, toolTier - requiredToolTier) * config.equipmentTierSpeedBonus
  return Math.max(1, Math.round(baseMinutes / (1 + bonus)))
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

export function equipmentWear(): number {
  return config.equipmentWearPerCycle
}
