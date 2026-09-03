// =============================================================
// Вставка камней — панель «Государственная вставка камней».
//
// Панель макета складывает вставку из трёх частей: вещь, камень и
// огранка, и рядом держит столбец цен по сортам камня. Столбец этот
// и есть прайс: камень покупается у казны в момент вставки, отдельным
// предметом в сумке он не лежит. Огранка платы не берёт — она только
// говорит, куда лягут очки камня.
//
// Отсюда разделение обязанностей:
//   камень  — сколько очков даёт вставка (сорт и цена);
//   огранка — в какую характеристику эти очки уйдут.
//
// Это отдельная механика от повышения уровня: там своя вероятность и
// расход деталей, здесь вставка либо проходит, либо не начинается.
// =============================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { withIdempotency } from '../../shared/db/idempotency'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { EconomyService } from '../economy/economy.service'
import { applyUpgradeModifiers, isUpgradeCompatible, type UpgradeKind } from './upgrades.formulas'
import {
  SOCKETS_PER_ITEM, cutByKind, readSockets, socketAllocation, stoneByCode,
} from './upgrades.stones'

/** Вещь годится под вставку — условия те же, что и для улучшения. */
function assertItemFits(
  item: { ownerId: string; status: string; template: { upgradeAllowed: boolean } },
  characterId: string,
) {
  if (item.ownerId !== characterId) throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Not your item', 403)
  if (!item.template.upgradeAllowed) throw new AppError(ErrorCode.UPG_NOT_ALLOWED, 'Upgrade unavailable', 400)
  if (item.status === 'BROKEN' || item.status === 'ON_MARKET') {
    throw new AppError(ErrorCode.UPG_ITEM_STATE, 'Item cannot be upgraded', 409)
  }
}

/** Сорт и огранка по кодам, с внятной ошибкой на неизвестный код. */
function readChoice(stoneCode: string, cutKind: string, itemType: string) {
  const stone = stoneByCode(stoneCode)
  if (!stone) throw new AppError(ErrorCode.UPG_INVALID_TYPE, 'Unknown stone', 400)
  const cut = cutByKind(cutKind)
  if (!cut) throw new AppError(ErrorCode.UPG_INVALID_TYPE, 'Unknown cut', 400)
  if (!isUpgradeCompatible(itemType, cut.kind)) {
    throw new AppError(ErrorCode.UPG_INVALID_TYPE, 'Cut does not fit this item', 400)
  }
  return { stone, cut }
}

export const SocketsService = {
  /** Что выйдет из вставки и можно ли её начинать. */
  async preview(characterId: string, itemInstanceId: string, stoneCode: string, cutKind: string) {
    const character = await prisma.character.findUniqueOrThrow({ where: { id: characterId } })
    const item = await prisma.itemInstance.findUnique({
      where: { id: itemInstanceId },
      include: { template: true },
    })
    if (!item) throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Not your item', 403)
    assertItemFits(item, characterId)

    const { stone, cut } = readChoice(stoneCode, cutKind, item.template.type)
    const sockets = readSockets(item.socketsJson)
    const next = [...sockets, { stone: stone.code, cut: cut.kind }]
    const mods = (item.upgradeModifiersJson as Partial<Record<UpgradeKind, number>> | null) ?? {}
    return {
      itemId: item.id,
      socketsUsed: sockets.length,
      socketsMax: SOCKETS_PER_ITEM,
      price: stone.fee,
      gain: { kind: cut.kind, points: stone.points },
      enoughMoney: character.money >= stone.fee,
      hasFreeSocket: sockets.length < SOCKETS_PER_ITEM,
      canCommit: sockets.length < SOCKETS_PER_ITEM && character.money >= stone.fee,
      currentAllocation: socketAllocation(item.socketsJson),
      effectiveStats: applyUpgradeModifiers(item.template, mods, item.statAllocation, next),
    }
  },

  /** Вставка: казна берёт цену сорта, гнездо занимается. */
  async insert(
    characterId: string,
    itemInstanceId: string,
    stoneCode: string,
    cutKind: string,
    key: string,
  ) {
    return withIdempotency({ characterId, scope: 'upgrades.sockets.insert', key, execute: async tx => {
      const character = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
      if (['IN_BATTLE', 'WORKING'].includes(character.status)) {
        throw new AppError(ErrorCode.UPG_CHARACTER_BUSY, 'Character is busy', 409)
      }

      const item = await tx.itemInstance.findUnique({
        where: { id: itemInstanceId },
        include: { template: true },
      })
      if (!item) throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Not your item', 403)
      assertItemFits(item, characterId)

      const { stone, cut } = readChoice(stoneCode, cutKind, item.template.type)
      const sockets = readSockets(item.socketsJson)
      if (sockets.length >= SOCKETS_PER_ITEM) {
        throw new AppError(ErrorCode.UPG_MAX_LEVEL, 'No free socket', 400)
      }

      const newBalance = await EconomyService.debit(tx, {
        characterId, amount: stone.fee, reasonCode: 'UPGRADE_COST', refType: 'socket', refId: item.id,
      })

      const next = [...sockets, { stone: stone.code, cut: cut.kind }]
      const mods = (item.upgradeModifiersJson as Partial<Record<UpgradeKind, number>> | null) ?? {}
      const stats = applyUpgradeModifiers(item.template, mods, item.statAllocation, next)
      // Прочность растёт от очков, поэтому текущую тянем пропорционально —
      // ровно так же, как это делает повышение уровня.
      const oldMax = item.durabilityMax
      const nextMax = cut.kind === 'DURABILITY' ? stats.durabilityMax : oldMax
      const nextCurrent = cut.kind === 'DURABILITY' && oldMax > 0
        ? Math.round(item.durabilityCurrent * nextMax / oldMax)
        : item.durabilityCurrent
      await tx.itemInstance.update({
        where: { id: item.id },
        // Prisma принимает в Json объект или примитив; массив нужно
        // провести через InputJsonValue явно.
        data: {
          socketsJson: next as unknown as Prisma.InputJsonValue,
          durabilityMax: nextMax,
          durabilityCurrent: nextCurrent,
        },
      })
      await tx.itemLog.create({
        data: {
          itemId: item.id, characterId, actionCode: 'SOCKET_INSERTED',
          details: {
            stone: stone.code, cut: cut.kind,
            points: stone.points, price: stone.fee, socket: next.length,
          },
        },
      })

      return {
        itemId: item.id,
        socketsUsed: next.length,
        socketsMax: SOCKETS_PER_ITEM,
        gain: { kind: cut.kind, points: stone.points },
        price: stone.fee,
        newBalance,
        effectiveStats: stats,
      }
    } })
  },
}
