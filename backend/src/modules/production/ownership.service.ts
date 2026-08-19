import { BalanceConfig } from '../../config/balance.config'
import { prisma } from '../../shared/db/prisma'
import { withIdempotency } from '../../shared/db/idempotency'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { EconomyService } from '../economy/economy.service'
import { objectResalePayout, objectSalaryRange, objectWithdrawTax } from './ownership.formulas'

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
}
