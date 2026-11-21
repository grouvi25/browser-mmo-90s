import { prisma } from '../../shared/db/prisma'
import { marketPriceInRub } from './market.formulas'

/** Поддерживает историю до появления отдельных записей сделок. */
export async function marketTradesSince(since: Date, limit = 20_000) {
  const [sales, legacy] = await Promise.all([
    prisma.marketSale.findMany({
      where: { soldAt: { gte: since } }, orderBy: { soldAt: 'desc' }, take: limit,
      select: {
        listingId: true, sellerCharacterId: true, buyerCharacterId: true, type: true, soldAt: true,
        amount: true, basePrice: true, currency: true, listing: { select: { itemInstanceId: true, resourceTemplateId: true } },
      },
    }),
    prisma.marketListing.findMany({
      where: { status: 'SOLD', soldAt: { gte: since }, buyerCharacterId: { not: null }, sales: { none: {} } },
      orderBy: { soldAt: 'desc' }, take: limit,
      select: {
        id: true, sellerCharacterId: true, buyerCharacterId: true, price: true, currency: true, type: true,
        soldAt: true, resourceAmount: true, itemInstanceId: true, resourceTemplateId: true,
      },
    }),
  ])
  return [
    ...sales.map(({ basePrice, currency, amount, listing, ...trade }) => ({
      ...trade, ...listing, price: marketPriceInRub(basePrice, currency), resourceAmount: amount,
    })),
    ...legacy.flatMap(({ id, price, currency, soldAt, buyerCharacterId, ...trade }) =>
      soldAt && buyerCharacterId ? [{ ...trade, listingId: id, soldAt, buyerCharacterId, price: marketPriceInRub(price, currency) }] : []),
  ].sort((a, b) => b.soldAt.getTime() - a.soldAt.getTime()).slice(0, limit)
}
