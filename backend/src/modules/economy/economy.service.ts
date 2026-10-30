import type { CurrencyLogReason, Prisma } from '@prisma/client'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { getEconomicLevelFromExp } from '../stats/stats.formulas'
import { BalanceConfig } from '../../config/balance.config'

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
      throw new AppError(ErrorCode.ECON_INVALID_AMOUNT, 'Credit amount must be a positive integer', 422)
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
      throw new AppError(ErrorCode.ECON_INVALID_AMOUNT, 'Debit amount must be a positive integer', 422)
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
    if (!Number.isInteger(amount) || amount < 0) throw new AppError(ErrorCode.ECON_INVALID_AMOUNT, 'Invalid economic exp', 422)
    const character = await tx.character.findUniqueOrThrow({ where: { id: characterId }, select: { economicExp: true, economicLevel: true } })
    const economicExp = character.economicExp + amount
    const economicLevel = getEconomicLevelFromExp(economicExp)
    // За каждый новый уровень — по разу: сила и премия десятой долей порога
    // (книга «Ревизия 2»). Уровень вниз не идёт: опыт только копится.
    const gained = Math.max(0, economicLevel - character.economicLevel)
    const E = BalanceConfig.economicExp
    const levelMoney = Array.from({ length: gained }, (_, i) => character.economicLevel + 1 + i)
      .reduce((sum, level) => sum + Math.floor(E.levelMoneyShare * (E.levelThresholds[level] ?? 0)), 0)
    await tx.character.update({
      where: { id: characterId },
      data: { economicExp, economicLevel: Math.max(economicLevel, character.economicLevel), ...(levelMoney > 0 ? { money: { increment: levelMoney } } : {}) },
    })
    if (gained > 0 && E.strPerLevel > 0) {
      await tx.characterStats.update({ where: { characterId }, data: { str: { increment: gained * E.strPerLevel } } })
    }
    // Игрок видит, за что пришли сила и деньги (Дмитрий 29.10 не заметил
    // премий: начислялись молча). Запись в той же транзакции, что и премия.
    if (gained > 0) {
      const reached = Math.max(economicLevel, character.economicLevel)
      const parts = [E.strPerLevel > 0 ? `+${gained * E.strPerLevel} к силе` : '', levelMoney > 0 ? `+${levelMoney.toLocaleString('ru-RU')} ₽` : ''].filter(Boolean)
      await tx.gameNotice.create({ data: { characterId, text: `Новый экономический уровень ${reached}${parts.length ? `: ${parts.join(', ')}` : ''}.` } })
    }
    return { economicExp, economicLevel, levelsGained: gained, levelMoney }
  },
}
