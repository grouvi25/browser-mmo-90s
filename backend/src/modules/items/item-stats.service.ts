import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { allocatedPoints, allowedItemStats, mergeAllocations, normalizeAllocation, type ItemStatKey } from './item-stats.formulas'
export const ItemStatsService = {
  async allocate(characterId: string, itemInstanceId: string, stat: ItemStatKey, points: number) {
    return withTransaction(async tx => {
      const character = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
      if (character.status === 'IN_BATTLE') throw new AppError(ErrorCode.CONFLICT, 'Cannot allocate item points during battle', 409)
      const item = await tx.itemInstance.findUnique({ where: { id: itemInstanceId }, include: { template: true } })
      if (!item || item.ownerId !== characterId) throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Not your item', 403)
      if (item.status === 'ON_MARKET') throw new AppError(ErrorCode.CONFLICT, 'Market item cannot be changed', 409)
      if (item.template.allocationMode !== 'PLAYER') throw new AppError(ErrorCode.CONFLICT, 'Item allocation is fixed', 409)
      if (!allowedItemStats(item.template.type).includes(stat)) throw new AppError(ErrorCode.CONFLICT, 'Stat is incompatible with item', 422)
      const before = normalizeAllocation(item.statAllocation)
      const available = Math.max(0, item.template.statBudget - allocatedPoints(before))
      if (points > available) throw new AppError(ErrorCode.CONFLICT, 'Not enough free item points', 409)
      const after = { ...before, [stat]: (before[stat] ?? 0) + points }
      const freePoints = available - points
      const oldDurabilityPoints = mergeAllocations(item.template.statAllocation, before, item.upgradeModifiersJson).DURABILITY ?? 0
      const newDurabilityPoints = mergeAllocations(item.template.statAllocation, after, item.upgradeModifiersJson).DURABILITY ?? 0
      const oldMax = Math.round(item.template.durabilityMax * (1 + .08 * oldDurabilityPoints))
      const newMax = Math.round(item.template.durabilityMax * (1 + .08 * newDurabilityPoints))
      const durabilityCurrent = stat === 'DURABILITY' && oldMax > 0 ? Math.round(item.durabilityCurrent * newMax / oldMax) : item.durabilityCurrent
      const changed = await tx.itemInstance.updateMany({ where: { id: item.id, ownerId: characterId, status: { not: 'ON_MARKET' } }, data: { statAllocation: after, freePoints, durabilityMax: newMax, durabilityCurrent } })
      if (changed.count !== 1) throw new AppError(ErrorCode.CONFLICT, 'Item allocation changed concurrently', 409)
      await tx.itemLog.create({ data: { itemId: item.id, characterId, actionCode: 'POINTS_ALLOCATED', details: { stat, points, before, after, freePoints } } })
      return { itemId: item.id, statAllocation: after, freePoints }
    })
  },
}
