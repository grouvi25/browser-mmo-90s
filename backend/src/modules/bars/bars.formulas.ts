export type IntoxicationState = 'SOBER' | 'TIPSY' | 'DRUNK' | 'WASTED'

export interface IntoxicationModifiers {
  state: IntoxicationState
  accuracy: number
  incomingDamage: number
  outgoingDamage: number
  canBattle: boolean
}

export function decayedAlcohol(level: number, updatedAt: Date | null, now = new Date()): number {
  if (level <= 0) return 0
  if (!updatedAt) return Math.min(100, level)
  const elapsedMs = Math.max(0, now.getTime() - updatedAt.getTime())
  const decay = elapsedMs / (3 * 3_600_000) * 100
  return Math.max(0, Math.round((level - decay) * 100) / 100)
}

export function intoxicationModifiers(level: number): IntoxicationModifiers {
  if (level >= 70) return { state: 'WASTED', accuracy: -0.04, incomingDamage: -0.06, outgoingDamage: 0, canBattle: false }
  if (level >= 30) return { state: 'DRUNK', accuracy: -0.02, incomingDamage: -0.04, outgoingDamage: 0, canBattle: true }
  if (level >= 1) return { state: 'TIPSY', accuracy: -0.01, incomingDamage: -0.02, outgoingDamage: 0.02, canBattle: true }
  return { state: 'SOBER', accuracy: 0, incomingDamage: 0, outgoingDamage: 0, canBattle: true }
}

export function barPriceRange(baseCost: number): { min: number; max: number } {
  return { min: baseCost, max: baseCost * 3 }
}

export function barSaleSplit(price: number): { tax: number; ownerIncome: number } {
  const tax = Math.floor(price * 0.2)
  return { tax, ownerIncome: price - tax }
}

export function canTakeBuff(lastBuffAt: Date | null, now = new Date()): boolean {
  return !lastBuffAt || now.getTime() - lastBuffAt.getTime() >= 12 * 3_600_000
}
