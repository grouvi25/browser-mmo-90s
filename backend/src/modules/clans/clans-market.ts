import type { Prisma } from '@prisma/client'
import { relationPriceMultiplier } from './clans.formulas'

export type MarketClanRelation = 'SELF' | 'ALLY' | 'NEUTRAL' | 'ENEMY'

export async function marketClanRelation(tx: Prisma.TransactionClient, buyerId: string, sellerId: string): Promise<MarketClanRelation> {
  const [buyer, seller] = await Promise.all([
    tx.character.findUnique({ where: { id: buyerId }, select: { clanId: true } }),
    tx.character.findUnique({ where: { id: sellerId }, select: { clanId: true } }),
  ])
  if (!buyer?.clanId || !seller?.clanId) return 'NEUTRAL'
  if (buyer.clanId === seller.clanId) return 'SELF'
  const rows = await tx.clanRelation.findMany({
    where: { confirmed: true, OR: [
      { fromClanId: buyer.clanId, toClanId: seller.clanId },
      { fromClanId: seller.clanId, toClanId: buyer.clanId },
    ] },
  })
  if (rows.some(row => row.type === 'HOSTILITY')) return 'ENEMY'
  if (rows.some(row => row.type === 'ALLIANCE')) return 'ALLY'
  return 'NEUTRAL'
}

export function marketPriceForRelation(price: number, relation: MarketClanRelation): number {
  return Math.max(1, Math.round(price * relationPriceMultiplier(relation)))
}
