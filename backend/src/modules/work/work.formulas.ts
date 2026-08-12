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
/**
 * Усталость за смену — согласованное отклонение от §10.5.
 *
 * В каноне формула зарплаты множителя усталости не содержит: там только
 * objectLevelCoeff, workerEfficiency и случайный разброс 0.9–1.1. Коэффициент
 * добавлен как антифарм: без него восемь смен в сутки дают ровную ставку
 * восемь раз подряд, и работа превращается в равномерный кран денег.
 *
 * Вторая смена за сутки даёт 80 % ставки, третья 60 %, четвёртая 40 %,
 * пятая и далее 20 %. Отклонение зафиксировано в docs/STAGE2_AUDIT.md;
 * если заказчик его не примет — достаточно вернуть 1.
 */
export function dailyShiftSalaryCoeff(shiftNumber: number): number {
  const normalized = Math.max(1, Math.min(8, Math.floor(shiftNumber)))
  return Math.max(WORK_BALANCE.salaryFatigueFloor, 1 - (normalized - 1) * WORK_BALANCE.salaryFatigueStep)
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
