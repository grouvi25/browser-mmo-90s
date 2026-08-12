import { BalanceConfig } from '../../config/balance.config'
import { getRedis } from '../../shared/db/redis'
import { audit } from '../../shared/logger/audit-logger'
import { priceRatio, suspiciousPriceReason } from './market-abuse.formulas'

const DAY_TTL_SECONDS = 48 * 60 * 60

export function auditSuspiciousPrice(params: {
  characterId: string
  listingId: string
  price: number
  referencePrice: number
}): void {
  const reason = suspiciousPriceReason(params.price, params.referencePrice)
  if (!reason) return
  audit('economy.suspicious', {
    type: reason,
    characterId: params.characterId,
    listingId: params.listingId,
    price: params.price,
    referencePrice: params.referencePrice,
    ratio: priceRatio(params.price, params.referencePrice),
  })
}

export async function recordPairTrade(sellerId: string, buyerId: string, listingId: string): Promise<number> {
  const date = new Date().toISOString().slice(0, 10)
  const pair = [sellerId, buyerId].sort().join(':')
  const key = `economy:suspicious:pair:${date}:${pair}`
  const redis = getRedis()
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, DAY_TTL_SECONDS)
  if (count > BalanceConfig.economy.suspicious.pairTradesPerDayMax) {
    audit('economy.suspicious', { type: 'REPEATED_PAIR_TRADES', sellerId, buyerId, listingId, count, date })
  }
  return count
}

export async function recordMarketCancel(characterId: string, listingId: string): Promise<number> {
  const date = new Date().toISOString().slice(0, 10)
  const key = `economy:suspicious:cancels:${date}:${characterId}`
  const redis = getRedis()
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, DAY_TTL_SECONDS)
  if (count > BalanceConfig.economy.suspicious.cancelsPerDayMax) {
    audit('economy.suspicious', { type: 'EXCESSIVE_MARKET_CANCELS', characterId, listingId, count, date })
  }
  return count
}
