import { BalanceConfig } from '../../config/balance.config'
import { prisma } from '../../shared/db/prisma'
import { withIdempotency } from '../../shared/db/idempotency'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { EconomyService } from '../economy/economy.service'
import { DollarsService } from '../dollars/dollars.service'
import { ResourcesService } from '../resources/resources.service'
import { ObjectInventoryService } from './inventory.service'
import { objectRepairQuote, objectResalePayout, objectSalaryRange, objectWithdrawTax, profileSwitchEndsAt } from './ownership.formulas'

const config = BalanceConfig.economy.production

/**
 * Кто распоряжается объектом. Частным — хозяин. Объектом бригады — её
 * участник с правом «Объекты» (главарь и бригадир по умолчанию): правка
 * заказчика 28.10 «нет возможности главе клана управлять недвижкой —
 * забирать ресурсы, пополнять деньги на объект». Деньги и сырьё объекта
 * бригады ходят через общак и склад бригады, а не через карман того, кто
 * нажал кнопку: иначе право «Объекты» стало бы правом вынести общее.
 */
type Manager = { kind: 'PRIVATE' } | { kind: 'CLAN'; clanId: string }

async function managerOf(
  tx: Prisma.TransactionClient,
  object: { ownerType: string; ownerCharacterId: string | null; ownerClanId: string | null },
  characterId: string,
): Promise<Manager> {
  if (object.ownerType === 'PRIVATE' && object.ownerCharacterId === characterId) return { kind: 'PRIVATE' }
  if (object.ownerType === 'CLAN' && object.ownerClanId) {
    const member = await tx.clanMember.findUnique({ where: { characterId }, include: { role: true } })
    if (member?.status === 'ACTIVE' && member.clanId === object.ownerClanId && permissionsOf(member.role).includes('OBJECTS')) {
      return { kind: 'CLAN', clanId: object.ownerClanId }
    }
  }
  throw new AppError(ErrorCode.PROD_NOT_OWNER, 'Объект вам не принадлежит', 403)
}

/** Условие на владельца для атомарных UPDATE: объект не сменил хозяина между чтением и записью. */
function ownedBy(manager: Manager, characterId: string) {
  return manager.kind === 'PRIVATE'
    ? { ownerType: 'PRIVATE' as const, ownerCharacterId: characterId }
    : { ownerType: 'CLAN' as const, ownerClanId: manager.clanId }
}

/** Движение по общаку бригады с записью в журнал. Списание — только если хватает. */
async function moveTreasury(tx: Prisma.TransactionClient, clanId: string, characterId: string, amount: number, reason: string): Promise<number> {
  if (amount < 0) {
    const taken = await tx.clan.updateMany({ where: { id: clanId, treasury: { gte: -amount } }, data: { treasury: { decrement: -amount } } })
    if (taken.count !== 1) throw new AppError(ErrorCode.PROD_BALANCE_LOW, 'В общаке бригады не хватает денег', 409)
  } else {
    await tx.clan.update({ where: { id: clanId }, data: { treasury: { increment: amount } } })
  }
  const clan = await tx.clan.findUniqueOrThrow({ where: { id: clanId }, select: { treasury: true } })
  await tx.clanTreasuryLog.create({ data: { clanId, characterId, amount, balanceAfter: clan.treasury, reason } })
  return clan.treasury
}

export const OwnershipService = {
  async buy(characterId: string, objectId: string, key: string) {
    return withIdempotency({ characterId, scope: 'objects.buy', key, execute: async tx => {
      const owned = await tx.productionObject.count({
        where: { ownerType: 'PRIVATE', ownerCharacterId: characterId },
      })
      if (owned >= config.maxObjectsPerCharacter) {
        throw new AppError(ErrorCode.PROD_OBJECT_LIMIT, 'Достигнут лимит объектов', 409)
      }
      const object = await tx.productionObject.findUniqueOrThrow({ where: { id: objectId } })
      if (!object.isForSale || object.ownerType !== 'SYSTEM' || !object.purchasePrice) {
        throw new AppError(ErrorCode.PROD_NOT_FOR_SALE, 'Объект не продаётся', 409)
      }
      const profession = await tx.characterProfession.findUnique({
        where: {
          characterId_professionCode: {
            characterId,
            professionCode: object.requiredProfessionCode,
          },
        },
      })
      if ((profession?.level ?? 0) < object.requiredProfessionLevel) {
        throw new AppError(ErrorCode.PROD_PROFESSION_TOO_LOW, 'Недостаточный уровень профессии', 400)
      }
      // Заказчик 28.10: у государства объекты только за доллары. Рублёвая
      // purchasePrice осталась для выкупа у тех, кто купил раньше за рубли.
      const priceUsd = config.objectPriceUsd
      const newDollars = await DollarsService.debit(tx, {
        characterId, amount: priceUsd, reason: 'PURCHASE', refId: objectId, note: object.name,
      })
      const claimed = await tx.productionObject.updateMany({
        where: { id: objectId, ownerType: 'SYSTEM', isForSale: true },
        data: { ownerType: 'PRIVATE', ownerCharacterId: characterId, isForSale: false, paidUsd: priceUsd },
      })
      if (claimed.count !== 1) throw new AppError(ErrorCode.PROD_ALREADY_SOLD, 'Объект уже продан', 409)
      await tx.productionLog.create({
        data: {
          characterId,
          productionObjectId: objectId,
          eventType: 'OBJECT_OWNERSHIP_CHANGED',
          metadataJson: { from: 'SYSTEM', to: characterId, priceUsd },
        },
      })
      return { objectId, priceUsd, newDollars }
    } })
  },

  async sell(characterId: string, objectId: string, key: string) {
    return withIdempotency({ characterId, scope: 'objects.sell', key, execute: async tx => {
      const object = await tx.productionObject.findUniqueOrThrow({
        where: { id: objectId },
        include: { inventory: true },
      })
      if (object.ownerCharacterId !== characterId || object.ownerType !== 'PRIVATE') {
        throw new AppError(ErrorCode.PROD_NOT_OWNER, 'Объект вам не принадлежит', 403)
      }
      const activeCycles = await tx.productionCycle.count({
        where: { productionObjectId: objectId, status: { in: ['PENDING', 'RUNNING'] } },
      })
      if (activeCycles > 0) throw new AppError(ErrorCode.PROD_CYCLE_ACTIVE, 'На объекте идёт производственный цикл', 409)
      if (object.inventory.some(item => item.amount > 0 || item.reservedAmount > 0)) {
        throw new AppError(ErrorCode.PROD_STORAGE_NOT_EMPTY, 'Перед продажей освободите склад', 409)
      }
      if (object.balance !== 0 || object.maintenanceDebt !== 0) {
        throw new AppError(ErrorCode.PROD_BALANCE_LOW, 'Перед продажей выведите баланс и погасите долг', 409)
      }
      // Выкуп в той валюте, в которой объект куплен: купленные до 28.10 за
      // рубли (paidUsd пуст) так и выкупаются за рубли — их не трогаем.
      const currency = object.paidUsd ? 'USD' as const : 'RUB' as const
      const payout = objectResalePayout(object.paidUsd ?? object.purchasePrice ?? 0)
      if (payout <= 0) throw new AppError(ErrorCode.PROD_NOT_FOR_SALE, 'Для объекта не задана цена выкупа', 409)
      const claimed = await tx.productionObject.updateMany({
        where: { id: objectId, ownerType: 'PRIVATE', ownerCharacterId: characterId },
        data: {
          ownerType: 'SYSTEM',
          ownerCharacterId: null,
          isForSale: true,
          balance: 0,
          salaryOverride: null,
          maintenanceDebt: 0,
          paidUsd: null,
        },
      })
      if (claimed.count !== 1) throw new AppError(ErrorCode.PROD_NOT_OWNER, 'Владелец объекта изменился', 409)
      const newBalance = currency === 'USD'
        ? await DollarsService.credit(tx, { characterId, amount: payout, reason: 'OBJECT_SALE', refId: objectId, note: object.name })
        : await EconomyService.credit(tx, {
          characterId, amount: payout, reasonCode: 'OBJECT_SALE', refType: 'production_object', refId: objectId,
        })
      await tx.productionLog.create({
        data: {
          characterId,
          productionObjectId: objectId,
          eventType: 'OBJECT_OWNERSHIP_CHANGED',
          metadataJson: { from: characterId, to: 'SYSTEM', payout, currency },
        },
      })
      return { payout, currency, newBalance }
    } })
  },

  async topUp(characterId: string, objectId: string, amount: number, key: string) {
    return withIdempotency({ characterId, scope: 'objects.balance.topup', key, execute: async tx => {
      const object = await tx.productionObject.findUniqueOrThrow({ where: { id: objectId } })
      const manager = await managerOf(tx, object, characterId)
      // Объект бригады пополняется из общака, частный — из кармана хозяина.
      const newCharacterBalance = manager.kind === 'CLAN'
        ? null
        : await EconomyService.debit(tx, {
          characterId, amount, reasonCode: 'OBJECT_BALANCE_TOP_UP', refType: 'production_object', refId: objectId,
        })
      const treasury = manager.kind === 'CLAN' ? await moveTreasury(tx, manager.clanId, characterId, -amount, 'OBJECT_TOP_UP') : null
      const debtPaid = Math.min(object.maintenanceDebt, amount)
      const balanceIncrement = amount - debtPaid
      const updated = await tx.productionObject.update({
        where: { id: objectId },
        data: {
          balance: { increment: balanceIncrement },
          maintenanceDebt: { decrement: debtPaid },
        },
      })
      await tx.productionLog.create({
        data: { characterId, productionObjectId: objectId, eventType: 'OBJECT_BALANCE_CHANGED', metadataJson: { topUp: amount, balance: updated.balance } },
      })
      return { balance: updated.balance, newCharacterBalance, treasury }
    } })
  },

  async withdraw(characterId: string, objectId: string, amount: number, key: string) {
    return withIdempotency({ characterId, scope: 'objects.withdraw', key, execute: async tx => {
      const object = await tx.productionObject.findUniqueOrThrow({ where: { id: objectId } })
      const manager = await managerOf(tx, object, characterId)
      const claimed = await tx.productionObject.updateMany({
        where: { id: objectId, ...ownedBy(manager, characterId), balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      })
      if (claimed.count !== 1) throw new AppError(ErrorCode.PROD_BALANCE_LOW, 'Недостаточно денег на балансе объекта', 409)
      const tax = objectWithdrawTax(amount)
      const payout = amount - tax
      // Прибыль объекта бригады уходит в общак, а не тому, кто её снял.
      const newBalance = manager.kind === 'CLAN'
        ? null
        : await EconomyService.credit(tx, {
          characterId, amount: payout, reasonCode: 'OBJECT_WITHDRAW', refType: 'production_object', refId: objectId,
        })
      const treasury = manager.kind === 'CLAN' ? await moveTreasury(tx, manager.clanId, characterId, payout, 'OBJECT_WITHDRAW') : null
      await tx.productionLog.create({
        data: { characterId, productionObjectId: objectId, eventType: 'OBJECT_BALANCE_CHANGED', metadataJson: { withdraw: amount, tax, payout } },
      })
      return { payout, tax, newBalance, treasury }
    } })
  },

  /**
   * Забрать со склада объекта к себе (обещание игрокам 23.10: «владелец
   * завода получает ресурсы, которые остаются у него, и он может
   * перерабатывать или продавать их»). Раньше склад объекта нельзя было ни
   * пополнить, ни разобрать: выпуск копился там навсегда, а цикл с сырьём
   * на входе не мог стартовать вовсе.
   */
  async stockTake(characterId: string, objectId: string, resourceCode: string, amount: number, key: string) {
    return withIdempotency({ characterId, scope: 'objects.stock.take', key, execute: async tx => {
      const object = await tx.productionObject.findUniqueOrThrow({ where: { id: objectId } })
      const manager = await managerOf(tx, object, characterId)
      const template = await tx.resourceTemplate.findUnique({ where: { code: resourceCode } })
      if (!template) throw new AppError(ErrorCode.PROD_INVARIANT, 'Нет такого ресурса', 404)
      const rows = await tx.productionObjectInventory.findMany({ where: { productionObjectId: objectId, resourceCode } })
      const free = rows.reduce((sum, row) => sum + row.amount - row.reservedAmount, 0)
      if (free < amount) throw new AppError(ErrorCode.PROD_RESERVED, `На складе объекта свободно только ${free}`, 409, { free })
      let left = amount
      for (const row of rows) {
        const take = Math.min(left, row.amount - row.reservedAmount)
        if (take <= 0) continue
        const changed = await tx.productionObjectInventory.updateMany({
          where: { id: row.id, amount: row.amount, reservedAmount: row.reservedAmount },
          data: { amount: { decrement: take } },
        })
        if (changed.count !== 1) throw new AppError(ErrorCode.PROD_INVARIANT, 'Склад объекта изменился, повторите', 409)
        left -= take
        if (left === 0) break
      }
      // Выпуск объекта бригады — на склад бригады, оттуда берут по праву «Склад».
      if (manager.kind === 'CLAN') {
        const storage = await tx.clanStorage.upsert({
          where: { clanId_resourceCode: { clanId: manager.clanId, resourceCode } },
          update: { amount: { increment: amount } },
          create: { clanId: manager.clanId, resourceCode, amount },
        })
        await tx.clanStorageLog.create({ data: { clanId: manager.clanId, characterId, resourceCode, amount } })
        return { resourceCode, amount, ownAmount: storage.amount, objectLeft: free - amount, to: 'CLAN_STORAGE' as const }
      }
      const stack = await ResourcesService.add(tx, { characterId, resourceTemplateId: template.id, amount, reasonCode: 'OBJECT_STOCK_TAKE', refType: 'production_object', refId: objectId })
      return { resourceCode, amount, ownAmount: stack.amount, objectLeft: free - amount, to: 'OWN' as const }
    } })
  },

  /** Положить своё сырьё на склад объекта — им цикл и питается. */
  async stockPut(characterId: string, objectId: string, resourceCode: string, amount: number, key: string) {
    return withIdempotency({ characterId, scope: 'objects.stock.put', key, execute: async tx => {
      const object = await tx.productionObject.findUniqueOrThrow({ where: { id: objectId } })
      await managerOf(tx, object, characterId)
      const template = await tx.resourceTemplate.findUnique({ where: { code: resourceCode } })
      if (!template) throw new AppError(ErrorCode.PROD_INVARIANT, 'Нет такого ресурса', 404)
      const stack = await tx.resourceStack.findUnique({ where: { characterId_resourceTemplateId: { characterId, resourceTemplateId: template.id } } })
      const free = Math.max(0, (stack?.amount ?? 0) - (stack?.reservedAmount ?? 0))
      if (free < amount) throw new AppError(ErrorCode.RES_INSUFFICIENT, `У вас свободно только ${free}`, 409, { free })
      await ResourcesService.consume(tx, { characterId, resourceTemplateId: template.id, amount, reasonCode: 'OBJECT_STOCK_PUT', refType: 'production_object', refId: objectId })
      const row = await ObjectInventoryService.put(tx, { objectId, resourceCode, quality: 'NORMAL', amount, capacity: object.storageCapacity })
      return { resourceCode, amount, objectAmount: row.amount }
    } })
  },

  async setSalary(characterId: string, objectId: string, salary: number) {
    const object = await prisma.productionObject.findUniqueOrThrow({ where: { id: objectId } })
    await managerOf(prisma, object, characterId)
    const { min, max } = objectSalaryRange(object.baseSalary)
    if (!Number.isInteger(salary) || salary < min || salary > max) {
      throw new AppError(ErrorCode.PROD_SALARY_RANGE, 'Ставка вне допустимого коридора', 422, { min, max })
    }
    const updated = await prisma.productionObject.update({
      where: { id: objectId }, data: { salaryOverride: salary },
    })
    return { salary: updated.salaryOverride }
  },

  async switchProfile(characterId: string, objectId: string, recipeId: string, key: string) {
    return withIdempotency({ characterId, scope: 'objects.profile', key, execute: async tx => {
      const object = await tx.productionObject.findUniqueOrThrow({ where: { id: objectId } })
      await managerOf(tx, object, characterId)
      if (object.profileSwitchEndsAt) throw new AppError(ErrorCode.PROD_CYCLE_BLOCKED, 'Object profile is already switching', 409)
      const activeCycles = await tx.productionCycle.count({ where: { productionObjectId: objectId, status: { in: ['PENDING', 'RUNNING'] } } })
      if (activeCycles > 0) throw new AppError(ErrorCode.PROD_CYCLE_ACTIVE, 'Production cycle is active', 409)
      const recipe = await tx.productionRecipe.findUniqueOrThrow({ where: { id: recipeId } })
      if (!recipe.isActive || recipe.productionObjectCode !== object.code) {
        throw new AppError(ErrorCode.PROD_RECIPE_INVALID, 'Recipe is unavailable for this object', 422)
      }
      const newBalance = await EconomyService.debit(tx, {
        characterId, amount: config.profileSwitchCost, reasonCode: 'OBJECT_PROFILE_SWITCH', refType: 'production_object', refId: objectId,
      })
      const endsAt = profileSwitchEndsAt()
      await tx.productionObject.update({ where: { id: objectId }, data: { pendingRecipeId: recipeId, profileSwitchEndsAt: endsAt } })
      await tx.productionLog.create({ data: {
        characterId, productionObjectId: objectId, eventType: 'OBJECT_PROFILE_SWITCHED',
        metadataJson: { fromRecipeId: object.activeRecipeId, toRecipeId: recipeId, status: 'STARTED', endsAt },
      } })
      return { recipeId, endsAt, cost: config.profileSwitchCost, newBalance }
    } })
  },

  async repair(characterId: string, objectId: string, key: string) {
    return withIdempotency({ characterId, scope: 'objects.repair', key, execute: async tx => {
      const object = await tx.productionObject.findUniqueOrThrow({ where: { id: objectId } })
      const manager = await managerOf(tx, object, characterId)
      const activeCycles = await tx.productionCycle.count({ where: { productionObjectId: objectId, status: { in: ['PENDING', 'RUNNING'] } } })
      if (activeCycles > 0) throw new AppError(ErrorCode.PROD_CYCLE_ACTIVE, 'Cannot repair during a production cycle', 409)
      const quote = objectRepairQuote(object.durabilityCurrent, object.durabilityMax)
      if (quote.durability === 0) return { repaired: false as const, ...quote }
      const inventory = await tx.productionObjectInventory.findUnique({ where: { productionObjectId_resourceCode_quality: {
        productionObjectId: objectId, resourceCode: config.repairResourceCode, quality: 'NORMAL',
      } } })
      if (!inventory || inventory.amount - inventory.reservedAmount < quote.kits) {
        throw new AppError(ErrorCode.PROD_INPUT_MISSING, 'Repair kits are missing', 409, { resourceCode: config.repairResourceCode, required: quote.kits })
      }
      // Статус снимается вместе с прочностью. Иначе объект, повреждённый
      // диверсией Этапа 4, чинился по числам, но навсегда оставался DAMAGED:
      // циклы на нём больше не запускались, и разовая диверсия стирала
      // объект насовсем — прямо против принципа П1.
      const paid = await tx.productionObject.updateMany({
        where: { id: objectId, ...ownedBy(manager, characterId), balance: { gte: quote.cost } },
        data: {
          balance: { decrement: quote.cost },
          durabilityCurrent: object.durabilityMax,
          ...(object.status === 'DAMAGED' ? { status: 'ACTIVE' as const } : {}),
        },
      })
      if (paid.count !== 1) throw new AppError(ErrorCode.PROD_BALANCE_LOW, 'Object balance is too low', 409)
      await tx.productionObjectInventory.update({ where: { id: inventory.id }, data: { amount: { decrement: quote.kits } } })
      await tx.productionLog.create({ data: {
        characterId, productionObjectId: objectId, eventType: 'OBJECT_REPAIRED',
        metadataJson: { from: object.durabilityCurrent, to: object.durabilityMax, ...quote },
      } })
      return { repaired: true as const, durabilityCurrent: object.durabilityMax, ...quote }
    } })
  },
}

// =============================================================
// ЭТАП 4 — КЛАНОВАЯ СОБСТВЕННОСТЬ НА ОБЪЕКТЫ
//
// Закрывает долг Этапа 3: в плане заказчика колхоз значился клановым, а
// реализован был как частная собственность.
//
// Перевод необратим. Это защита от схемы «перевёл в клан, снял через
// общак, вышел из клана»: обратимый перевод превращает клан в отмывочную.
//
// Лимит объектов клана растёт от числа территорий — так территория впервые
// нужна не ради бонуса, а ради права расширяться, и стратегический слой
// получает прямую связь с экономикой.
// ТЗ: docs/specs/stage-4/MASTER_TZ_STAGE_4_STRATEGY_PREMIUM_WAR.md, часть V.
// =============================================================
import { withTransaction } from '../../shared/db/transaction'
import type { Prisma } from '@prisma/client'

const strategy = BalanceConfig.strategy.clanObjects

export function clanObjectLimit(territories: number): number {
  return strategy.base + strategy.perTerritory * Math.max(0, territories)
}

function permissionsOf(role: { permissions: Prisma.JsonValue }): string[] {
  return Array.isArray(role.permissions)
    ? role.permissions.filter((value): value is string => typeof value === 'string')
    : []
}

export const ClanOwnershipService = {
  /**
   * Что будет при переводе. Отдельной ручкой: операция необратима.
   *
   * Ручка ИНФОРМАЦИОННАЯ и потому не бросает отказ, а возвращает его
   * причиной. Первая редакция отвечала 404 «вы не в клане», и интерфейс
   * из-за этого не показывал вообще ничего: игрок без бригады не узнавал,
   * что такая возможность существует и чего для неё не хватает.
   */
  async preview(characterId: string, objectId: string) {
    const object = await prisma.productionObject.findUniqueOrThrow({ where: { id: objectId } })
    const member = await prisma.clanMember.findUnique({
      where: { characterId }, include: { role: true, clan: true },
    })
    if (!member || member.status !== 'ACTIVE') {
      return {
        objectName: object.name,
        balanceMovedToTreasury: object.balance,
        clanObjects: 0,
        clanObjectLimit: 0,
        territories: 0,
        irreversible: true as const,
        canTransfer: false,
        blockedReason: 'NO_CLAN' as const,
      }
    }
    const territories = await prisma.territory.count({
      where: { ownerClanId: member.clanId, status: 'CONTROLLED' },
    })
    const owned = await prisma.productionObject.count({
      where: { ownerType: 'CLAN', ownerClanId: member.clanId },
    })
    const limit = clanObjectLimit(territories)
    const notOwner = object.ownerCharacterId !== characterId || object.ownerType !== 'PRIVATE'
    const blockedReason = notOwner ? 'NOT_OWNER' as const
      : object.status === 'DAMAGED' ? 'DAMAGED' as const
      : !permissionsOf(member.role).includes('OBJECTS') ? 'NO_PERMISSION' as const
      : owned >= limit ? 'LIMIT_REACHED' as const
      : null
    return {
      objectName: object.name,
      balanceMovedToTreasury: object.balance,
      clanObjects: owned,
      clanObjectLimit: limit,
      territories,
      irreversible: true as const,
      canTransfer: blockedReason === null,
      blockedReason,
    }
  },

  /** Перевести свой объект в клан. Необратимо. */
  async transfer(characterId: string, objectId: string) {
    return withTransaction(async tx => {
      const member = await tx.clanMember.findUnique({
        where: { characterId }, include: { role: true },
      })
      if (!member || member.status !== 'ACTIVE') {
        throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Вы не состоите в клане', 404)
      }
      if (!permissionsOf(member.role).includes('OBJECTS')) {
        throw new AppError(ErrorCode.WAR_NO_PERMISSION, 'Нет права управлять объектами клана', 403)
      }
      const object = await tx.productionObject.findUniqueOrThrow({ where: { id: objectId } })
      if (object.ownerType !== 'PRIVATE' || object.ownerCharacterId !== characterId) {
        throw new AppError(ErrorCode.PROD_NOT_OWNER, 'Вы не владелец объекта', 403)
      }
      // Повреждённый объект нельзя сдать клану: иначе перевод станет
      // способом переложить ремонт на общак и выйти.
      if (object.status === 'DAMAGED') {
        throw new AppError(ErrorCode.WAR_OBJECT_DAMAGED, 'Объект повреждён, сначала восстановите', 409)
      }

      const territories = await tx.territory.count({
        where: { ownerClanId: member.clanId, status: 'CONTROLLED' },
      })
      const owned = await tx.productionObject.count({
        where: { ownerType: 'CLAN', ownerClanId: member.clanId },
      })
      const limit = clanObjectLimit(territories)
      if (owned >= limit) {
        throw new AppError(
          ErrorCode.WAR_CLAN_OBJECT_LIMIT,
          `У клана достигнут предел объектов: ${limit}`,
          409,
        )
      }

      const moved = object.balance
      await tx.productionObject.update({
        where: { id: objectId },
        data: {
          ownerType: 'CLAN', ownerClanId: member.clanId,
          ownerCharacterId: null, balance: 0,
        },
      })
      let treasuryAfter = 0
      if (moved !== 0) {
        const clan = await tx.clan.update({
          where: { id: member.clanId },
          data: { treasury: { increment: moved } },
        })
        treasuryAfter = clan.treasury
        await tx.clanTreasuryLog.create({
          data: {
            clanId: member.clanId, characterId, amount: moved,
            balanceAfter: clan.treasury, reason: 'OBJECT_TRANSFERRED',
          },
        })
      } else {
        treasuryAfter = (await tx.clan.findUniqueOrThrow({
          where: { id: member.clanId }, select: { treasury: true },
        })).treasury
      }
      await tx.productionLog.create({
        data: {
          productionObjectId: objectId, characterId, eventType: 'TRANSFERRED_TO_CLAN',
          metadataJson: { clanId: member.clanId, balanceMoved: moved },
        },
      })
      return { objectId, clanId: member.clanId, balanceMoved: moved, treasuryAfter, limit }
    })
  },
}
