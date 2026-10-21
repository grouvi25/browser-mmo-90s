// =============================================================
// Профессия «Торгаш» и правила валют рынка (правка заказчика 21.10).
//
// «На рынок любой игрок выставляет ТОЛЬКО ресурсы. Чтобы продавать вещи,
// нужна профессия Торгаш: 1 лвл — только за рубли, 2 лвл (за донат) —
// и за доллары. Ресурсы: добытчик 1 лвл — за рубли, 2 лвл — за доллары.
// Налог с продажи везде. У каждого торгаша магазин со своим ID».
// =============================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { EconomyService } from '../economy/economy.service'
import { DollarsService } from '../dollars/dollars.service'

/** Стартовые цены — заказчик их не называл. */
export const TRADER = { level1PriceRub: 5000, level2PriceUsd: 30, firstShopNumber: 1001 }

/** Добывающие профессии: первый передел каждого направления. */
export const GATHERING_PROFESSIONS = ['scrap_collector', 'supplier', 'procurer'] as const

export type Currency = 'RUB' | 'USD'

/** Можно ли выставить лот в этой валюте. Бросает понятную ошибку. */
export async function assertCanList(
  tx: Prisma.TransactionClient, characterId: string, kind: 'ITEM' | 'RESOURCE', currency: Currency,
): Promise<void> {
  const char = await tx.character.findUniqueOrThrow({ where: { id: characterId }, select: { traderLevel: true } })
  if (kind === 'ITEM') {
    if (char.traderLevel < 1) throw new AppError(ErrorCode.MARKET_ITEM_INVALID, 'Вещи продаёт только Торгаш. На общий рынок — только ресурсы', 403)
    if (currency === 'USD' && char.traderLevel < 2) throw new AppError(ErrorCode.MARKET_ITEM_INVALID, 'За доллары продаёт Торгаш 2-го уровня', 403)
    return
  }
  if (currency === 'USD') {
    const best = await tx.characterProfession.findFirst({
      where: { characterId, professionCode: { in: [...GATHERING_PROFESSIONS] }, level: { gte: 2 } }, select: { level: true },
    })
    if (!best && char.traderLevel < 2) throw new AppError(ErrorCode.MARKET_RESOURCE_INVALID, 'Ресурсы за доллары продаёт добытчик 2-го уровня', 403)
  }
}

export const TraderService = {
  async status(characterId: string) {
    const [char, gathering] = await Promise.all([
      prisma.character.findUniqueOrThrow({ where: { id: characterId }, select: { traderLevel: true, shopNumber: true } }),
      prisma.characterProfession.findFirst({ where: { characterId, professionCode: { in: [...GATHERING_PROFESSIONS] }, level: { gte: 2 } }, select: { level: true } }),
    ])
    return {
      traderLevel: char.traderLevel, shopNumber: char.shopNumber, prices: TRADER,
      canSellResourcesForUsd: !!gathering || char.traderLevel >= 2,
    }
  },

  /** 1-й уровень — за рубли и сразу магазин с номером; 2-й — за доллары. */
  async buyLevel(characterId: string, level: 1 | 2) {
    return withTransaction(async tx => {
      await tx.$executeRaw`SELECT id FROM characters WHERE id = ${characterId} FOR UPDATE`
      const char = await tx.character.findUniqueOrThrow({ where: { id: characterId }, select: { traderLevel: true, shopNumber: true } })
      if (char.traderLevel >= level) throw new AppError(ErrorCode.CONFLICT, 'Этот уровень Торгаша у вас уже есть', 409)
      if (level === 2 && char.traderLevel < 1) throw new AppError(ErrorCode.CONFLICT, 'Сначала 1-й уровень Торгаша', 409)
      if (level === 1) {
        await EconomyService.debit(tx, { characterId, amount: TRADER.level1PriceRub, reasonCode: 'SHOP_PURCHASE', refType: 'trader', refId: '1' })
      } else {
        await DollarsService.debit(tx, { characterId, amount: TRADER.level2PriceUsd, reason: 'PURCHASE', note: 'Торгаш 2-го уровня' })
      }
      let shopNumber = char.shopNumber
      if (!shopNumber) {
        const top = await tx.character.aggregate({ _max: { shopNumber: true } })
        shopNumber = Math.max(TRADER.firstShopNumber, (top._max.shopNumber ?? 0) + 1)
      }
      await tx.character.update({ where: { id: characterId }, data: { traderLevel: level, shopNumber } })
      return { traderLevel: level, shopNumber }
    })
  },

  /** Магазин торгаша по номеру: хозяин и его лоты. */
  async shop(shopNumber: number) {
    const owner = await prisma.character.findUnique({ where: { shopNumber }, select: { id: true, nickname: true, traderLevel: true, shopNumber: true } })
    if (!owner || owner.traderLevel < 1) throw new AppError(ErrorCode.NOT_FOUND, `Магазина №${shopNumber} нет`, 404)
    return owner
  },

  /** Все магазины торгашей — чтобы лавку можно было найти и без номера. */
  async directory() {
    const owners = await prisma.character.findMany({
      where: { traderLevel: { gte: 1 }, shopNumber: { not: null } },
      select: { id: true, nickname: true, traderLevel: true, shopNumber: true },
      orderBy: { shopNumber: 'asc' }, take: 200,
    })
    const counts = await prisma.marketListing.groupBy({
      by: ['sellerCharacterId'], where: { status: 'ACTIVE', sellerCharacterId: { in: owners.map(o => o.id) } }, _count: { _all: true },
    })
    const byId = new Map(counts.map(c => [c.sellerCharacterId, c._count._all]))
    return owners.map(o => ({ ...o, listings: byId.get(o.id) ?? 0 }))
  },
}
