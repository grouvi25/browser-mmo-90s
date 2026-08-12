import { BalanceConfig } from '../../config/balance.config'

export function priceRatio(price: number, referencePrice: number): number {
  return price / Math.max(1, referencePrice)
}

export function suspiciousPriceReason(price: number, referencePrice: number): 'PRICE_TOO_LOW' | 'PRICE_TOO_HIGH' | null {
  const ratio = priceRatio(price, referencePrice)
  const config = BalanceConfig.economy.suspicious
  if (ratio < config.priceRatioMin) return 'PRICE_TOO_LOW'
  if (ratio > config.priceRatioMax) return 'PRICE_TOO_HIGH'
  return null
}
