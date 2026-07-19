import { prisma } from '../../shared/db/prisma'
import type { CurrencyLogReason, ItemLogAction } from '@prisma/client'

export const LogsRepository = {
  // -------------------------------------------------------
  // Currency Log
  // -------------------------------------------------------
  async logCurrency(data: {
    characterId: string
    amount: number
    balanceAfter: number
    reasonCode: CurrencyLogReason
    refId?: string
    refType?: string
    note?: string
  }): Promise<void> {
    await prisma.currencyLog.create({ data })
  },

  async getCurrencyLogs(characterId: string, limit = 50) {
    return prisma.currencyLog.findMany({
      where: { characterId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  },

  // -------------------------------------------------------
  // Item Log
  // -------------------------------------------------------
  async logItem(data: {
    itemId: string
    characterId: string
    actionCode: ItemLogAction
    details?: object
  }): Promise<void> {
    await prisma.itemLog.create({
      data: {
        ...data,
        details: data.details ?? undefined,
      },
    })
  },

  // -------------------------------------------------------
  // Repair Log
  // -------------------------------------------------------
  async logRepair(data: {
    characterId: string
    itemId: string
    cost: number
    durabilityBefore: number
    durabilityAfter: number
  }): Promise<void> {
    await prisma.repairLog.create({ data })
  },

  async getRepairLogs(characterId: string, limit = 50) {
    return prisma.repairLog.findMany({
      where: { characterId },
      orderBy: { repairedAt: 'desc' },
      take: limit,
    })
  },
}
