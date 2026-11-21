import type { MarketListing, Prisma } from '@prisma/client'
import { BalanceConfig } from '../../config/balance.config'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { marketClanRelation, marketPriceForRelation, type MarketClanRelation } from '../clans/clans-market'
import { isBonusSuspended } from '../territories/territories.formulas'
import { calcMarketSellerEcoExp, calcSaleTax } from './market.formulas'

export interface MarketPurchase {
  amount: number
  revision: number
  finalPrice: number
}

export function canBuyPart(listing: Pick<MarketListing, 'type' | 'resourceAmount' | 'price'>) {
  const count = listing.resourceAmount ?? 0
  return listing.type === 'RESOURCE' && count > 1 && listing.price % count === 0
}

export async function marketBuyerPrice(
  tx: Prisma.TransactionClient, listingId: string, buyerId: string, relation: MarketClanRelation, base: number,
) {
  const { _sum } = await tx.marketSale.aggregate({
    where: { listingId, buyerCharacterId: buyerId, relation }, _sum: { basePrice: true },
  })
  const before = _sum.basePrice ?? 0
  return marketPriceForRelation(before + base, relation) - (before ? marketPriceForRelation(before, relation) : 0)
}

export async function quoteMarketPurchase(
  tx: Prisma.TransactionClient, buyerId: string, listingId: string, requested?: number, expectedRevision?: number,
) {
  const listing = await tx.marketListing.findUnique({ where: { id: listingId } })
  if (!listing || listing.status !== 'ACTIVE' || listing.expiresAt <= new Date()) {
    throw new AppError(ErrorCode.MARKET_UNAVAILABLE, 'Лот больше недоступен', 409)
  }
  if (listing.sellerCharacterId === buyerId) {
    throw new AppError(ErrorCode.MARKET_OWN_LISTING, 'Нельзя купить свой лот', 403)
  }
  if (expectedRevision !== undefined && expectedRevision !== listing.revision) {
    throw new AppError(ErrorCode.MARKET_UNAVAILABLE, 'Лот изменился. Проверьте количество и цену ещё раз', 409)
  }
  const available = listing.resourceAmount ?? 1
  const amount = requested ?? available
  if (!Number.isInteger(amount) || amount < 1 || amount > available) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Укажите количество от 1 до текущего остатка лота', 422)
  }
  if (amount !== available && !canBuyPart(listing)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Этот лот продаётся целиком', 422)
  }
  const basePrice = amount === available ? listing.price : listing.price / available * amount
  const relation = await marketClanRelation(tx, buyerId, listing.sellerCharacterId)
  const finalPrice = await marketBuyerPrice(tx, listing.id, buyerId, relation, basePrice)
  return { listing, amount, basePrice, finalPrice, relation, remainingAmount: available - amount }
}

export async function marketSaleAmounts(
  tx: Prisma.TransactionClient, quote: Awaited<ReturnType<typeof quoteMarketPurchase>>,
) {
  const { listing, relation, basePrice, finalPrice } = quote
  const sellerGross = relation === 'ENEMY' ? basePrice : finalPrice
  const sellerTaxRate = BalanceConfig.economy.market.saleTaxRate
  const ecoExpRate = BalanceConfig.economicExp.turnoverRate
  const [taxHistory, expHistory, market] = await Promise.all([
    tx.marketSale.aggregate({ where: { listingId: listing.id, sellerTaxRate }, _sum: { sellerGross: true } }),
    tx.marketSale.aggregate({ where: { listingId: listing.id, ecoExpRate }, _sum: { sellerGross: true } }),
    listing.currency === 'RUB' ? tx.territory.findUnique({
      where: { code: 'market' },
      select: { ownerClanId: true, status: true, bonusCode: true, bonusValue: true, upkeepDebt: true },
    }) : null,
  ])
  const priorTaxGross = taxHistory._sum.sellerGross ?? 0
  const priorExpGross = expHistory._sum.sellerGross ?? 0
  const sellerTax = calcSaleTax(priorTaxGross + sellerGross) - calcSaleTax(priorTaxGross)
  const ecoExp = calcMarketSellerEcoExp(priorExpGross + sellerGross) - calcMarketSellerEcoExp(priorExpGross)
  const payout = sellerGross - sellerTax
  const tax = finalPrice - payout
  const marketClanId = market?.status === 'CONTROLLED' && market.bonusCode === 'MARKET_SHARE'
    && !isBonusSuspended(market.upkeepDebt) ? market.ownerClanId : null
  const marketShareRate = marketClanId && market ? market.bonusValue : null
  let marketShare = 0
  if (marketClanId && marketShareRate !== null && tax > 0) {
    const history = await tx.marketSale.aggregate({
      where: { listingId: listing.id, marketClanId, marketShareRate }, _sum: { tax: true },
    })
    const priorTax = history._sum.tax ?? 0
    marketShare = Math.floor((priorTax + tax) * marketShareRate) - Math.floor(priorTax * marketShareRate)
  }
  return { sellerGross, sellerTaxRate, ecoExpRate, sellerTax, ecoExp, tax, payout, marketClanId, marketShareRate, marketShare }
}
