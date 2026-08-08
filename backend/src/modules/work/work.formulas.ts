import { BalanceConfig } from '../../config/balance.config'
const WORK_BALANCE=BalanceConfig.economy.work
export const PRODUCTION_LEVEL_THRESHOLDS = [0, 500, 1500, 3500, 8000, 16000, 30000] as const

/** Legacy alias. Functional progression is stored independently per profession. */
export function getProductionLevelFromExp(exp: number): number {
  let level = 0
  for (let i = 0; i < PRODUCTION_LEVEL_THRESHOLDS.length; i++) if (exp >= PRODUCTION_LEVEL_THRESHOLDS[i]) level = i
  return Math.min(6, level)
}
export function workerEfficiency(productionLevel: number): number { return 1 + Math.max(0, productionLevel) * WORK_BALANCE.efficiencyPerProfessionLevel }
export function objectLevelCoeff(level: number): number { return 1 + WORK_BALANCE.objectLevelStep * (Math.max(1, level) - 1) }
export function dailyShiftSalaryCoeff(shiftNumber: number): number {
  const normalized = Math.max(1, Math.min(8, Math.floor(shiftNumber)))
  return Math.max(0.20, 1 - (normalized - 1) * 0.20)
}

export function calcFinalSalary(
  baseSalary: number,
  objectLevel: number,
  productionLevel: number,
  roll = Math.random(),
  dailyShiftNumber = 1,
): number {
  const randomCoeff = WORK_BALANCE.salaryRandomMin + Math.min(1, Math.max(0, roll)) * (WORK_BALANCE.salaryRandomMax - WORK_BALANCE.salaryRandomMin)
  const fatigueCoeff = dailyShiftSalaryCoeff(dailyShiftNumber)
  const raw = Math.round(baseSalary * objectLevelCoeff(objectLevel) * workerEfficiency(productionLevel) * randomCoeff * fatigueCoeff)
  return Math.max(1, Math.min(raw, baseSalary * WORK_BALANCE.salaryCapMultiplier))
}
export function calcProductionExp(baseExp: number, objectLevel: number): number { return Math.max(0, Math.round(baseExp * objectLevelCoeff(objectLevel))) }
