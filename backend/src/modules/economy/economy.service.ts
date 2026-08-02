import type { CurrencyLogReason, Prisma } from '@prisma/client'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { getEconomicLevelFromExp } from '../stats/stats.formulas'

interface MoneyOperation {
  characterId: string
  amount: number
  reasonCode: CurrencyLogReason
  refType?: string
  refId?: string
  note?: string
}

export const EconomyService = {
  async credit(tx: Prisma.TransactionClient, operation: MoneyOperation) {
    if (!Number.isInteger(operation.amount) || operation.amount <= 0) {
      throw new AppError(ErrorCode.CONFLICT, 'Credit amount must be a positive integer', 422)
    }
    const character = await tx.character.update({
      where: { id: operation.characterId },
      data: { money: { increment: operation.amount } },
      select: { money: true },
    })
    await tx.currencyLog.create({
      data: { ...operation, balanceAfter: character.money },
    })
    return character.money
  },

  async debit(tx: Prisma.TransactionClient, operation: MoneyOperation) {
    if (!Number.isInteger(operation.amount) || operation.amount <= 0) {
      throw new AppError(ErrorCode.CONFLICT, 'Debit amount must be a positive integer', 422)
    }
    const updated = await tx.character.updateMany({
      where: { id: operation.characterId, money: { gte: operation.amount } },
      data: { money: { decrement: operation.amount } },
    })
    if (updated.count !== 1) {
      const character = await tx.character.findUnique({ where: { id: operation.characterId }, select: { money: true } })
      throw AppError.insufficientFunds(character?.money ?? 0, operation.amount)
    }
    const character = await tx.character.findUniqueOrThrow({ where: { id: operation.characterId }, select: { money: true } })
    await tx.currencyLog.create({
      data: { ...operation, amount: -operation.amount, balanceAfter: character.money },
    })
    return character.money
  },

  async grantEconomicExp(tx: Prisma.TransactionClient, characterId: string, amount: number) {
    if (!Number.isInteger(amount) || amount < 0) throw new AppError(ErrorCode.CONFLICT, 'Invalid economic exp', 422)
    const character = await tx.character.findUniqueOrThrow({ where: { id: characterId }, select: { economicExp: true } })
    const economicExp = character.economicExp + amount
    const economicLevel = getEconomicLevelFromExp(economicExp)
    await tx.character.update({ where: { id: characterId }, data: { economicExp, economicLevel } })
    return { economicExp, economicLevel }
  },
}
