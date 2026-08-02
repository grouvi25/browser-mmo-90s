import { prisma } from '../../shared/db/prisma'
import type { ItemLogAction } from '@prisma/client'

export const LogsRepository = {
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
