import { BalanceConfig } from '../../config/balance.config'
import { prisma } from '../../shared/db/prisma'
import { withIdempotency } from '../../shared/db/idempotency'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { EconomyService } from '../economy/economy.service'
import { objectRepairQuote, objectResalePayout, objectSalaryRange, objectWithdrawTax, profileSwitchEndsAt } from './ownership.formulas'

const config = BalanceConfig.economy.production

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
      const newBalance = await EconomyService.debit(tx, {
        characterId,
        amount: object.purchasePrice,
        reasonCode: 'OBJECT_PURCHASE',
        refType: 'production_object',
        refId: objectId,
      })
      const claimed = await tx.productionObject.updateMany({
        where: { id: objectId, ownerType: 'SYSTEM', isForSale: true },
        data: { ownerType: 'PRIVATE', ownerCharacterId: characterId, isForSale: false },
      })
      if (claimed.count !== 1) throw new AppError(ErrorCode.PROD_ALREADY_SOLD, 'Объект уже продан', 409)
      await tx.productionLog.create({
        data: {
          characterId,
          productionObjectId: objectId,
          eventType: 'OBJECT_OWNERSHIP_CHANGED',
          metadataJson: { from: 'SYSTEM', to: characterId, price: object.purchasePrice },
        },
      })
      return { objectId, newBalance }
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
      const payout = objectResalePayout(object.purchasePrice ?? 0)
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
        },
      })
      if (claimed.count !== 1) throw new AppError(ErrorCode.PROD_NOT_OWNER, 'Владелец объекта изменился', 409)
      const newBalance = await EconomyService.credit(tx, {
        characterId, amount: payout, reasonCode: 'OBJECT_SALE', refType: 'production_object', refId: objectId,
      })
      await tx.productionLog.create({
        data: {
          characterId,
          productionObjectId: objectId,
          eventType: 'OBJECT_OWNERSHIP_CHANGED',
          metadataJson: { from: characterId, to: 'SYSTEM', payout },
        },
      })
      return { payout, newBalance }
    } })
  },

  async topUp(characterId: string, objectId: string, amount: number, key: string) {
    return withIdempotency({ characterId, scope: 'objects.balance.topup', key, execute: async tx => {
      const object = await tx.productionObject.findUniqueOrThrow({ where: { id: objectId } })
      if (object.ownerCharacterId !== characterId) throw new AppError(ErrorCode.PROD_NOT_OWNER, 'Объект вам не принадлежит', 403)
      const newCharacterBalance = await EconomyService.debit(tx, {
        characterId, amount, reasonCode: 'OBJECT_BALANCE_TOP_UP', refType: 'production_object', refId: objectId,
      })
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
      return { balance: updated.balance, newCharacterBalance }
    } })
  },

  async withdraw(characterId: string, objectId: string, amount: number, key: string) {
    return withIdempotency({ characterId, scope: 'objects.withdraw', key, execute: async tx => {
      const object = await tx.productionObject.findUniqueOrThrow({ where: { id: objectId } })
      if (object.ownerCharacterId !== characterId) throw new AppError(ErrorCode.PROD_NOT_OWNER, 'Объект вам не принадлежит', 403)
      const claimed = await tx.productionObject.updateMany({
        where: { id: objectId, ownerCharacterId: characterId, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      })
      if (claimed.count !== 1) throw new AppError(ErrorCode.PROD_BALANCE_LOW, 'Недостаточно денег на балансе объекта', 409)
      const tax = objectWithdrawTax(amount)
      const payout = amount - tax
      const newBalance = await EconomyService.credit(tx, {
        characterId, amount: payout, reasonCode: 'OBJECT_WITHDRAW', refType: 'production_object', refId: objectId,
      })
      await tx.productionLog.create({
        data: { characterId, productionObjectId: objectId, eventType: 'OBJECT_BALANCE_CHANGED', metadataJson: { withdraw: amount, tax, payout } },
      })
      return { payout, tax, newBalance }
    } })
  },

  async setSalary(characterId: string, objectId: string, salary: number) {
    const object = await prisma.productionObject.findUniqueOrThrow({ where: { id: objectId } })
    if (object.ownerCharacterId !== characterId) throw new AppError(ErrorCode.PROD_NOT_OWNER, 'Объект вам не принадлежит', 403)
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
      if (object.ownerCharacterId !== characterId) throw new AppError(ErrorCode.PROD_NOT_OWNER, 'Object is not owned by character', 403)
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
      if (object.ownerCharacterId !== characterId) throw new AppError(ErrorCode.PROD_NOT_OWNER, 'Object is not owned by character', 403)
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
      const paid = await tx.productionObject.updateMany({
        where: { id: objectId, ownerCharacterId: characterId, balance: { gte: quote.cost } },
        data: { balance: { decrement: quote.cost }, durabilityCurrent: object.durabilityMax },
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
  /** Что будет при переводе. Отдельной ручкой: операция необратима. */
  async preview(characterId: string, objectId: string) {
    const member = await prisma.clanMember.findUnique({
      where: { characterId }, include: { role: true, clan: true },
    })
    if (!member || member.status !== 'ACTIVE') {
      throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Вы не состоите в клане', 404)
    }
    const object = await prisma.productionObject.findUniqueOrThrow({ where: { id: objectId } })
    const territories = await prisma.territory.count({
      where: { ownerClanId: member.clanId, status: 'CONTROLLED' },
    })
    const owned = await prisma.productionObject.count({
      where: { ownerType: 'CLAN', ownerClanId: member.clanId },
    })
    const limit = clanObjectLimit(territories)
    return {
      objectName: object.name,
      balanceMovedToTreasury: object.balance,
      clanObjects: owned,
      clanObjectLimit: limit,
      territories,
      irreversible: true as const,
      canTransfer: object.ownerCharacterId === characterId
        && object.ownerType === 'PRIVATE'
        && object.status !== 'DAMAGED'
        && owned < limit
        && permissionsOf(member.role).includes('OBJECTS'),
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
