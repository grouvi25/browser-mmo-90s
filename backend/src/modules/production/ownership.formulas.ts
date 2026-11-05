import { BalanceConfig } from '../../config/balance.config'

const config = BalanceConfig.economy.production

/** Сколько циклов цех ведёт сразу: на 1 уровне один, на 2 — несколько разных рецептов. */
export function cycleSlots(level: number): number {
  return level >= 2 ? Math.max(1, config.cyclesAtLevel2) : 1
}

export function objectWithdrawTax(amount: number): number {
  return Math.floor(amount * config.objectWithdrawTaxRate)
}

export function objectSalaryRange(baseSalary: number): { min: number; max: number } {
  return {
    min: Math.round(baseSalary * config.salaryRangeMin),
    max: Math.round(baseSalary * config.salaryRangeMax),
  }
}

export function objectResalePayout(purchasePrice: number): number {
  return Math.floor(purchasePrice * config.objectResaleRate)
}

export function objectRepairQuote(durabilityCurrent: number, durabilityMax: number) {
  const durability = Math.max(0, durabilityMax - durabilityCurrent)
  return {
    durability,
    kits: Math.ceil(durability / config.repairDurabilityPerKit),
    cost: durability * config.repairCostPerDurability,
  }
}

export function profileSwitchEndsAt(now = new Date()): Date {
  return new Date(now.getTime() + config.profileSwitchMinutes * 60_000)
}
