import { prisma } from '../../shared/db/prisma'
import type { ItemTemplate, GovernmentShopItem } from '@prisma/client'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { withTransaction } from '../../shared/db/transaction'
import { withIdempotency } from '../../shared/db/idempotency'
import { audit } from '../../shared/logger/audit-logger'
import { BalanceConfig } from '../../config/balance.config'
import { getEconomicLevelFromExp } from '../stats/stats.formulas'
import { EconomyService } from '../economy/economy.service'

export type ShopItemWithTemplate = GovernmentShopItem & { template: ItemTemplate }

export const GovernmentShopService = {
  async listItems(): Promise<ShopItemWithTemplate[]> {
    return prisma.governmentShopItem.findMany({
      where: { isAvailable: true, template: { isActive: true } },
      include: { template: true },
      orderBy: { sortOrder: 'asc' },
    })
  },

  async buy(characterId: string, templateId: string, key: string) {
    // Идемпотентность: покупка создаёт вещь и списывает деньги, клеймить
    // нечего. Без ключа сетевой повтор удавшегося запроса создавал вторую
    // вещь и списывал второй раз — как и на всех прочих платных путях,
    // теперь повтор с тем же ключом возвращает первый результат.
    return withIdempotency({ characterId, scope: 'government-shop.buy', key, execute: async (tx) => {
      // Load shop entry
      const shopEntry = await tx.governmentShopItem.findFirst({
        where: { templateId, isAvailable: true },
        include: { template: true },
      })
      if (!shopEntry || !shopEntry.template.isActive) {
        throw new AppError(ErrorCode.ITEM_NOT_AVAILABLE, 'Item is not available in shop', 404)
      }

      const price = shopEntry.overridePrice ?? shopEntry.template.priceBase

      // Load character
      const char = await tx.character.findUnique({ where: { id: characterId } })
      if (!char) throw AppError.notFound('Character', characterId)

      if (char.money < price) {
        throw AppError.insufficientFunds(char.money, price)
      }

      const newBalance = await EconomyService.debit(tx, {
        characterId, amount: price, reasonCode: 'SHOP_PURCHASE', refType: 'shop', refId: shopEntry.id,
      })

      // Create item instance
      const t = shopEntry.template
      const item = await tx.itemInstance.create({
        data: {
          templateId,
          ownerId: characterId,
          quality: t.qualityBase,
          durabilityCurrent: t.durabilityMax,
          durabilityMax: t.durabilityMax,
          weight: t.weight,
          sourceType: 'GOVERNMENT',
          usesLeft: t.type === 'TOOL' ? t.usesMax : null,
        },
      })

      // Log item
      await tx.itemLog.create({
        data: {
          itemId: item.id,
          characterId,
          actionCode: 'CREATED_FROM_SHOP',
          details: { templateId, price, templateName: t.name },
        },
      })

      audit('item.purchased', { characterId, itemId: item.id, templateId, price })
      return { item, newBalance }
    } })
  },

  async sell(characterId: string, itemInstanceId: string) {
    return withTransaction(async (tx) => {
      const item = await tx.itemInstance.findUnique({
        where: { id: itemInstanceId },
        include: { template: true },
      })
      if (!item) throw AppError.notFound('Item', itemInstanceId)
      if (item.ownerId !== characterId) {
        throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'You do not own this item', 403)
      }
      if (item.isEquipped) {
        throw new AppError(ErrorCode.ITEM_ALREADY_EQUIPPED, 'Unequip item before selling', 400)
      }
      if (!item.template.isSellable) {
        throw new AppError(ErrorCode.ITEM_NOT_SELLABLE, 'This item cannot be sold', 400)
      }

      // Помечаем проданным ПЕРЕД начислением денег и атомарно — по статусу.
      // Раньше проверки статуса не было вовсе: findUnique возвращает вещь
      // и после DELETED (ownerId не очищается), поэтому повтор запроса или
      // дабл-клик начислял деньги ещё раз за ту же вещь. Клейм по
      // { status: NORMAL|BROKEN } закрывает и повтор, и гонку: второй заход
      // не находит строку и падает до кредита.
      const claimed = await tx.itemInstance.updateMany({
        where: { id: itemInstanceId, ownerId: characterId, isEquipped: false, status: { in: ['NORMAL', 'BROKEN'] } },
        data: { status: 'DELETED', isEquipped: false },
      })
      if (claimed.count !== 1) {
        throw new AppError(ErrorCode.ITEM_NOT_SELLABLE, 'Item is no longer available to sell', 409)
      }

      const sellPrice = Math.floor(item.template.priceBase * 0.5) // 50% от базовой цены

      const char = await tx.character.findUnique({ where: { id: characterId } })
      if (!char) throw AppError.notFound('Character', characterId)
      const newBalance = await EconomyService.credit(tx, {
        characterId, amount: sellPrice, reasonCode: 'SHOP_SELL', refType: 'item', refId: itemInstanceId,
      })

      // Economic exp for selling (GanjaWars: price × 0.047 for new item, × 0.067 for broken)
      const isBroken = item.status === 'BROKEN'
      const ecoExpRate = isBroken
        ? BalanceConfig.economicExp.sellBrokenRate
        : BalanceConfig.economicExp.sellNewRate
      const ecoExpGain = Math.floor(item.template.priceBase * ecoExpRate)

      const newEcoExp = char.economicExp + ecoExpGain
      const newEcoLevel = getEconomicLevelFromExp(newEcoExp)

      await EconomyService.grantEconomicExp(tx, characterId, ecoExpGain)
      // Статус уже переведён в DELETED атомарным клеймом выше.

      await tx.itemLog.create({
        data: {
          itemId: itemInstanceId,
          characterId,
          actionCode: 'SOLD_TO_SHOP',
          details: { sellPrice, ecoExpGain },
        },
      })

      audit('item.sold', { characterId, itemId: itemInstanceId, sellPrice, ecoExpGain })
      return { sellPrice, newBalance, ecoExpGain, newEcoLevel }
    })
  },

  // Выбросить предмет (без денег)
  async discard(characterId: string, itemInstanceId: string) {
    const item = await prisma.itemInstance.findUnique({
      where: { id: itemInstanceId },
      include: { template: true },
    })
    if (!item) throw AppError.notFound('Item', itemInstanceId)
    if (item.ownerId !== characterId) {
      throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'You do not own this item', 403)
    }
    if (item.isEquipped) {
      throw new AppError(ErrorCode.ITEM_ALREADY_EQUIPPED, 'Unequip item before discarding', 400)
    }
    await prisma.itemInstance.update({
      where: { id: itemInstanceId },
      data: { status: 'DELETED' },
    })
    audit('item.discarded', { characterId, itemId: itemInstanceId })
    return { success: true }
  },
}
