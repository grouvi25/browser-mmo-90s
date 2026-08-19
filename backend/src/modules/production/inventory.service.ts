import type { Prisma, ResourceQuality } from '@prisma/client'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { isQualityAtLeast } from './cycle.formulas'

export const ObjectInventoryService = {
  async usedCapacity(tx: Prisma.TransactionClient, objectId: string): Promise<number> {
    const rows = await tx.productionObjectInventory.findMany({ where: { productionObjectId: objectId } })
    if (rows.length === 0) return 0
    const templates = await tx.resourceTemplate.findMany({
      where: { code: { in: [...new Set(rows.map(row => row.resourceCode))] } },
      select: { code: true, weight: true },
    })
    const weightOf = new Map(templates.map(template => [template.code, template.weight]))
    return rows.reduce((sum, row) => sum + row.amount * (weightOf.get(row.resourceCode) ?? 0), 0)
  },

  async put(tx: Prisma.TransactionClient, params: {
    objectId: string
    resourceCode: string
    quality: ResourceQuality
    amount: number
    capacity: number
  }) {
    if (params.amount <= 0) throw new AppError(ErrorCode.PROD_INVARIANT, 'Количество должно быть положительным', 400)
    const template = await tx.resourceTemplate.findUniqueOrThrow({
      where: { code: params.resourceCode },
      select: { weight: true },
    })
    const used = await this.usedCapacity(tx, params.objectId)
    if (used + params.amount * template.weight > params.capacity) {
      throw new AppError(ErrorCode.PROD_STORAGE_FULL, 'Склад объекта заполнен', 409)
    }
    return tx.productionObjectInventory.upsert({
      where: {
        productionObjectId_resourceCode_quality: {
          productionObjectId: params.objectId,
          resourceCode: params.resourceCode,
          quality: params.quality,
        },
      },
      update: { amount: { increment: params.amount } },
      create: {
        productionObjectId: params.objectId,
        resourceCode: params.resourceCode,
        quality: params.quality,
        amount: params.amount,
      },
    })
  },

  async reserve(tx: Prisma.TransactionClient, params: {
    objectId: string
    resourceCode: string
    minQuality: ResourceQuality
    amount: number
  }) {
    const candidates = (await tx.productionObjectInventory.findMany({
      where: { productionObjectId: params.objectId, resourceCode: params.resourceCode },
    }))
      .filter(candidate => isQualityAtLeast(candidate.quality, params.minQuality))
      .sort((left, right) => ['POOR', 'NORMAL', 'FINE'].indexOf(left.quality) - ['POOR', 'NORMAL', 'FINE'].indexOf(right.quality))
    const available = candidates.reduce((sum, row) => sum + row.amount - row.reservedAmount, 0)
    if (available < params.amount) throw new AppError(ErrorCode.PROD_INPUT_MISSING, 'Not enough input for production cycle', 409)

    let remaining = params.amount
    const reservations: Array<{ inventoryId: string; quality: ResourceQuality; amount: number }> = []
    for (const row of candidates) {
      if (remaining === 0) break
      const amount = Math.min(remaining, row.amount - row.reservedAmount)
      if (amount <= 0) continue
      const changed = await tx.productionObjectInventory.updateMany({
        where: { id: row.id, amount: row.amount, reservedAmount: row.reservedAmount },
        data: { reservedAmount: { increment: amount } },
      })
      if (changed.count !== 1) throw new AppError(ErrorCode.PROD_INVARIANT, 'Inventory changed during reservation', 409)
      reservations.push({ inventoryId: row.id, quality: row.quality, amount })
      remaining -= amount
    }
    return reservations
  },

  async consumeReserved(tx: Prisma.TransactionClient, inventoryId: string, amount: number): Promise<void> {
    const changed = await tx.productionObjectInventory.updateMany({
      where: { id: inventoryId, amount: { gte: amount }, reservedAmount: { gte: amount } },
      data: { amount: { decrement: amount }, reservedAmount: { decrement: amount } },
    })
    if (changed.count !== 1) throw new AppError(ErrorCode.PROD_INVARIANT, 'Не удалось списать резерв', 409)
  },

  async releaseReserved(tx: Prisma.TransactionClient, inventoryId: string, amount: number): Promise<void> {
    const changed = await tx.productionObjectInventory.updateMany({
      where: { id: inventoryId, reservedAmount: { gte: amount } },
      data: { reservedAmount: { decrement: amount } },
    })
    if (changed.count !== 1) throw new AppError(ErrorCode.PROD_INVARIANT, 'Не удалось освободить резерв', 409)
  },
}
