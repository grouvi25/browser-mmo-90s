import { withTransaction } from '../../shared/db/transaction'
import { socketAllocation } from '../upgrades/upgrades.stones'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { allocatedPoints, allowedItemStats, bonusCost, itemBudget, mergeAllocations, normalizeAllocation, type ItemStatAllocation, type ItemStatKey } from './item-stats.formulas'
import { readItemBonuses, syncHpWithGear, type ItemBonuses } from './gear-bonuses'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { withIdempotency } from '../../shared/db/idempotency'
import { BalanceConfig } from '../../config/balance.config'
import { DollarsService } from '../dollars/dollars.service'

const ITEM_ICON_MAX_BYTES = 100_000

/** Вещь игрока, которую можно настраивать: своя, не на рынке, хозяин не в бою. */
async function ownItem(tx: Prisma.TransactionClient, characterId: string, itemInstanceId: string) {
  const character = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
  if (character.status === 'IN_BATTLE') throw new AppError(ErrorCode.CONFLICT, 'Во время боя вещь менять нельзя', 409)
  const item = await tx.itemInstance.findUnique({ where: { id: itemInstanceId }, include: { template: true } })
  if (!item || item.ownerId !== characterId) throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Not your item', 403)
  if (item.status === 'ON_MARKET') throw new AppError(ErrorCode.CONFLICT, 'Вещь выставлена на рынок, менять её нельзя', 409)
  return item
}

export const ItemStatsService = {
  async allocate(characterId: string, itemInstanceId: string, stat: ItemStatKey, points: number) {
    return withTransaction(async tx => {
      const character = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
      if (character.status === 'IN_BATTLE') throw new AppError(ErrorCode.CONFLICT, 'Cannot allocate item points during battle', 409)
      const item = await tx.itemInstance.findUnique({ where: { id: itemInstanceId }, include: { template: true } })
      if (!item || item.ownerId !== characterId) throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Not your item', 403)
      if (item.status === 'ON_MARKET') throw new AppError(ErrorCode.CONFLICT, 'Вещь выставлена на рынок, менять её нельзя', 409)
      if (item.template.allocationMode !== 'PLAYER') throw new AppError(ErrorCode.CONFLICT, 'Очки этой вещи уже распределены', 409)
      if (!allowedItemStats(item.template.type).includes(stat)) throw new AppError(ErrorCode.CONFLICT, 'Эту характеристику нельзя вложить в эту вещь', 422)
      const before = normalizeAllocation(item.statAllocation)
      const available = Math.max(0, itemBudget(item.template, item.namedLevel) - allocatedPoints(before) - bonusCost(readItemBonuses(item.bonuses)))
      if (points > available) throw new AppError(ErrorCode.CONFLICT, 'У вещи не осталось свободных очков', 409)
      const after = { ...before, [stat]: (before[stat] ?? 0) + points }
      const freePoints = available - points
      const sockets = socketAllocation(item.socketsJson)
      const oldDurabilityPoints = mergeAllocations(item.template.statAllocation, before, item.upgradeModifiersJson, sockets).DURABILITY ?? 0
      const newDurabilityPoints = mergeAllocations(item.template.statAllocation, after, item.upgradeModifiersJson, sockets).DURABILITY ?? 0
      const oldMax = Math.round(item.template.durabilityMax * (1 + .08 * oldDurabilityPoints))
      const newMax = Math.round(item.template.durabilityMax * (1 + .08 * newDurabilityPoints))
      const durabilityCurrent = stat === 'DURABILITY' && oldMax > 0 ? Math.round(item.durabilityCurrent * newMax / oldMax) : item.durabilityCurrent
      const changed = await tx.itemInstance.updateMany({ where: { id: item.id, ownerId: characterId, status: { not: 'ON_MARKET' } }, data: { statAllocation: after, freePoints, durabilityMax: newMax, durabilityCurrent } })
      if (changed.count !== 1) throw new AppError(ErrorCode.CONFLICT, 'Вещь только что изменилась, обновите страницу', 409)
      await tx.itemLog.create({ data: { itemId: item.id, characterId, actionCode: 'POINTS_ALLOCATED', details: { stat, points, before, after, freePoints } } })
      return { itemId: item.id, statAllocation: after, freePoints }
    })
  },

  /**
   * Настройка именной вещи целиком (правка 31.10): игрок заполняет столбики и
   * жмёт «Сохранить». Приходит итог, а не прибавка: пока хозяин не в бою,
   * расклад можно переделать, очки считаются заново от бюджета вещи.
   */
  async configure(characterId: string, itemInstanceId: string, own: ItemStatAllocation, input: ItemBonuses) {
    return withTransaction(async tx => {
      const item = await ownItem(tx, characterId, itemInstanceId)
      if (item.template.allocationMode !== 'PLAYER') throw new AppError(ErrorCode.CONFLICT, 'Очки этой вещи уже распределены', 409)
      const before = normalizeAllocation(item.statAllocation)
      const allowed = allowedItemStats(item.template.type)
      const nextOwn = normalizeAllocation(own)
      delete nextOwn.DURABILITY
      if (Object.keys(nextOwn).some(key => !allowed.includes(key as ItemStatKey))) {
        throw new AppError(ErrorCode.CONFLICT, 'Эту характеристику нельзя вложить в эту вещь', 422)
      }
      // Старые очки прочности снять нельзя: их больше не вкладывают, но они есть.
      if (before.DURABILITY) nextOwn.DURABILITY = before.DURABILITY
      const bonuses = readItemBonuses(input)
      const budget = itemBudget(item.template, item.namedLevel)
      const spent = allocatedPoints(nextOwn) + bonusCost(bonuses)
      if (spent > budget) throw new AppError(ErrorCode.CONFLICT, `Расставлено ${spent} очков из ${budget}`, 409)
      const freePoints = budget - spent
      const changed = await tx.itemInstance.updateMany({
        where: { id: item.id, ownerId: characterId, status: { not: 'ON_MARKET' } },
        data: { statAllocation: nextOwn, bonuses: bonuses as unknown as Prisma.InputJsonValue, freePoints },
      })
      if (changed.count !== 1) throw new AppError(ErrorCode.CONFLICT, 'Вещь только что изменилась, обновите страницу', 409)
      await tx.itemLog.create({ data: { itemId: item.id, characterId, actionCode: 'POINTS_ALLOCATED', details: { own: nextOwn, bonuses, freePoints } as unknown as Prisma.InputJsonValue } })
      if (item.isEquipped) await syncHpWithGear(tx, characterId)
      return { itemId: item.id, statAllocation: nextOwn, bonuses, freePoints, budget }
    })
  },

  /** Уровень именной вещи за доллары: +50 очков в бюджет (заказчик 30.10). */
  async levelUp(characterId: string, itemInstanceId: string, key: string) {
    const config = BalanceConfig.economy.namedItems
    return withIdempotency({ characterId, scope: `items.level-up.${itemInstanceId}`, key, execute: async tx => {
      const item = await ownItem(tx, characterId, itemInstanceId)
      const fromTsum = await tx.dollarShopItem.findFirst({ where: { templateId: item.templateId, shop: 'TSUM' }, select: { id: true } })
      if (!fromTsum || item.template.allocationMode !== 'PLAYER') {
        throw new AppError(ErrorCode.CONFLICT, 'Уровень повышается только у именных вещей', 409)
      }
      if (item.namedLevel >= config.maxLevel) throw new AppError(ErrorCode.CONFLICT, 'У вещи уже последний уровень', 409)
      const dollars = await DollarsService.debit(tx, { characterId, amount: config.levelPriceUsd, reason: 'PURCHASE', refId: item.id, note: `Уровень вещи «${item.template.name}»` })
      const updated = await tx.itemInstance.update({
        where: { id: item.id },
        data: { namedLevel: { increment: 1 }, freePoints: { increment: config.pointsPerLevel } },
      })
      await tx.itemLog.create({ data: { itemId: item.id, characterId, actionCode: 'POINTS_ALLOCATED', details: { namedLevel: updated.namedLevel, priceUsd: config.levelPriceUsd } } })
      return { itemId: item.id, namedLevel: updated.namedLevel, freePoints: updated.freePoints, dollars }
    } })
  },

  /** Своя картинка именной вещи из ЦУМа (заказчик 30.10). Менять можно сколько угодно. */
  async setIcon(characterId: string, itemInstanceId: string, dataUrl: string) {
    const parsed = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (!parsed) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Картинка: PNG, JPEG или WebP', 422)
    if (Buffer.byteLength(parsed[2], 'base64') > ITEM_ICON_MAX_BYTES) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Картинка слишком большая: не больше 100 КБ', 422)
    }
    return withTransaction(async tx => {
      const item = await ownItem(tx, characterId, itemInstanceId)
      const fromTsum = await tx.dollarShopItem.findFirst({ where: { templateId: item.templateId, shop: 'TSUM' }, select: { id: true } })
      if (!fromTsum) throw new AppError(ErrorCode.CONFLICT, 'Свою картинку можно поставить только вещи из ЦУМа', 409)
      await tx.itemIcon.upsert({
        where: { itemId: item.id },
        create: { itemId: item.id, mime: parsed[1], data: parsed[2] },
        update: { mime: parsed[1], data: parsed[2] },
      })
      const updated = await tx.itemInstance.update({ where: { id: item.id }, data: { iconVersion: { increment: 1 } } })
      return { itemId: item.id, iconVersion: updated.iconVersion }
    })
  },

  async icon(itemInstanceId: string) {
    const icon = await prisma.itemIcon.findUnique({ where: { itemId: itemInstanceId } })
    return icon ? { mime: icon.mime, bytes: Buffer.from(icon.data, 'base64') } : null
  },
}
