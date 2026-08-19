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
