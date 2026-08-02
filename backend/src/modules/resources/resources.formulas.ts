export function calcGovernmentResourcePayout(amount: number, basePrice: number): number {
  if (!Number.isInteger(amount) || amount <= 0 || !Number.isInteger(basePrice) || basePrice < 0) return 0
  return Math.floor(amount * basePrice * 0.25)
}

export function calcResourceWeight(amount: number, unitWeight: number): number {
  return Math.max(0, amount) * Math.max(0, unitWeight)
}

export function availableResourceAmount(amount: number, reservedAmount: number): number {
  return Math.max(0, amount - reservedAmount)
}
