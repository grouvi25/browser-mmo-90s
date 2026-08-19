import { BalanceConfig } from '../../config/balance.config'

const config = BalanceConfig.economy.production

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
