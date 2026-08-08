import { BalanceConfig } from '../../config/balance.config'
const B=BalanceConfig.economy.resources
export function calcGovernmentResourcePayout(amount: number, basePrice: number): number {
  if (!Number.isInteger(amount) || amount <= 0 || !Number.isInteger(basePrice) || basePrice < 0) return 0
  return Math.floor(amount * basePrice * B.governmentPayoutRate)
}
export function calcResourceWeight(amount: number, unitWeight: number): number { return Math.max(0, amount) * Math.max(0, unitWeight) }
export function availableResourceAmount(amount: number, reservedAmount: number): number { return Math.max(0, amount - reservedAmount) }
export function calcGovernmentResourceEcoExp(amount: number, basePrice: number): number {
  if (!Number.isInteger(amount) || amount <= 0 || !Number.isInteger(basePrice) || basePrice < 0) return 0
  return Math.round(amount * basePrice * B.governmentEcoExpRate)
}
export function canReserveResource(amount: number, reservedAmount: number, requested: number): boolean { return Number.isInteger(requested) && requested > 0 && availableResourceAmount(amount, reservedAmount) >= requested }
export function assertResourceStackInvariant(amount: number, reservedAmount: number): void {
  if (!Number.isInteger(amount) || !Number.isInteger(reservedAmount) || amount < 0 || reservedAmount < 0 || reservedAmount > amount) throw new Error('Resource stack invariant violated')
}
