export const PRODUCTION_LEVEL_THRESHOLDS = [0, 50, 150, 350, 700, 1200, 2000, 3200, 5000, 7500, 11000] as const

export function getProductionLevelFromExp(exp: number): number {
  let level = 0
  for (let i = 0; i < PRODUCTION_LEVEL_THRESHOLDS.length; i++) if (exp >= PRODUCTION_LEVEL_THRESHOLDS[i]) level = i
  return Math.min(10, level)
}
export function workerEfficiency(productionLevel: number): number { return 1 + Math.max(0, productionLevel) * 0.03 }
export function objectLevelCoeff(level: number): number { return 1 + 0.25 * (Math.max(1, level) - 1) }
export function calcFinalSalary(baseSalary: number, objectLevel: number, productionLevel: number, roll = Math.random()): number {
  const randomCoeff = 0.9 + Math.min(1, Math.max(0, roll)) * 0.2
  const raw = Math.round(baseSalary * objectLevelCoeff(objectLevel) * workerEfficiency(productionLevel) * randomCoeff)
  return Math.max(1, Math.min(raw, baseSalary * 3))
}
export function calcProductionExp(baseExp: number, objectLevel: number): number { return Math.max(0, Math.round(baseExp * objectLevelCoeff(objectLevel))) }
