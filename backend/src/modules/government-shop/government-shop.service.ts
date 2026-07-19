import { prisma } from '../../shared/db/prisma'
import type { ItemTemplate, GovernmentShopItem } from '@prisma/client'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { ItemsRepository } from '../items/item-instance.repository'
import { LogsRepository } from '../logs/logs.repository'
import { withTransaction } from '../../shared/db/transaction'
import { audit } from '../../shared/logger/audit-logger'

export type ShopItemWithTemplate = GovernmentShopItem & { template: ItemTemplate }

export const GovernmentShopService = {
  async listItems(): Promise<ShopItemWithTemplate[]> {
    return prisma.governmentShopItem.findMany({
      where: { isAvailable: true, template: { isActive: true } },
      include: { template: true },
      orderBy: { sortOrder: 'asc' },
    })
  },

  async buy(characterId: string, templateId: string) {
    return withTransaction(async (tx) => {
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

      // Deduct money
      const newBalance = char.money - price
      await tx.character.update({ where: { id: characterId }, data: { money: newBalance } })

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
        },
      })

      // Log currency
      await tx.currencyLog.create({
        data: {
          characterId,
          amount: -price,
          balanceAfter: newBalance,
          reasonCode: 'SHOP_PURCHASE',
          refId: item.id,
          refType: 'item',
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
    })
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

      const sellPrice = Math.floor(item.template.priceBase * 0.3)

      const char = await tx.character.findUnique({ where: { id: characterId } })
      if (!char) throw AppError.notFound('Character', characterId)
      const newBalance = char.money + sellPrice

      await tx.character.update({ where: { id: characterId }, data: { money: newBalance } })
      await tx.itemInstance.update({ where: { id: itemInstanceId }, data: { status: 'DELETED', isEquipped: false } })

      await tx.currencyLog.create({
        data: {
          characterId,
          amount: sellPrice,
          balanceAfter: newBalance,
          reasonCode: 'SHOP_SELL',
          refId: itemInstanceId,
          refType: 'item',
        },
      })
      await tx.itemLog.create({
        data: {
          itemId: itemInstanceId,
          characterId,
          actionCode: 'SOLD_TO_SHOP',
          details: { sellPrice },
        },
      })

      audit('item.sold', { characterId, itemId: itemInstanceId, sellPrice })
      return { sellPrice, newBalance }
    })
  },
}
