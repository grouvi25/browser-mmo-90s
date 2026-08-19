import { prisma } from '../shared/db/prisma'
import { logger } from '../shared/logger/logger'
import { BalanceConfig } from '../config/balance.config'
import { AppError } from '../shared/errors/app-error'
import { ErrorCode } from '../shared/errors/error-codes'
import { CycleService } from '../modules/production/cycle.service'

export const PRODUCTION_CYCLE_MS = BalanceConfig.economy.production.cycleTickSeconds * 1000

export async function runProductionCycle(): Promise<{ started: number; completed: number; failed: number }> {
  const now = new Date()
  let started = 0
  let completed = 0
  let failed = 0

  const switched = await prisma.productionObject.findMany({
    where: { profileSwitchEndsAt: { lte: now }, pendingRecipeId: { not: null } },
    select: { id: true, ownerCharacterId: true, pendingRecipeId: true },
    take: 100,
  })
  for (const object of switched) {
    const updated = await prisma.productionObject.updateMany({
      where: { id: object.id, profileSwitchEndsAt: { lte: now }, pendingRecipeId: object.pendingRecipeId },
      data: { activeRecipeId: object.pendingRecipeId, pendingRecipeId: null, profileSwitchEndsAt: null },
    })
    if (updated.count === 1) {
      await prisma.productionLog.create({ data: {
        characterId: object.ownerCharacterId,
        productionObjectId: object.id,
        eventType: 'OBJECT_PROFILE_SWITCHED',
        metadataJson: { toRecipeId: object.pendingRecipeId, status: 'COMPLETED' },
      } })
    }
  }

  const due = await prisma.productionCycle.findMany({
    where: { status: 'RUNNING', endsAt: { lte: now } },
    take: 200,
  })
  for (const cycle of due) {
    try {
      const result = await CycleService.complete(cycle.id)
      if ('completed' in result) completed += 1
    } catch (error) {
      if (error instanceof AppError && error.code === ErrorCode.PROD_STORAGE_FULL) {
        const result = await CycleService.fail(cycle.id, 'OUTPUT_FULL')
        if ('failed' in result) failed += 1
      } else {
        logger.error({ error, cycleId: cycle.id }, '[ProductionCycle] completion failed')
      }
    }
  }

  const timeoutAt = new Date(now.getTime() - BalanceConfig.economy.production.laborTimeoutHours * 3_600_000)
  const stale = await prisma.productionCycle.findMany({
    where: { status: 'PENDING', createdAt: { lte: timeoutAt } },
    take: 100,
  })
  for (const cycle of stale) {
    const result = await CycleService.fail(cycle.id, 'LABOR_TIMEOUT')
    if ('failed' in result) failed += 1
  }

  const idle = await prisma.productionObject.findMany({
    where: {
      isActive: true,
      status: 'ACTIVE',
      activeRecipeId: { not: null },
      cycles: { none: { status: { in: ['PENDING', 'RUNNING'] } } },
    },
    take: 100,
  })
  for (const object of idle) {
    try {
      const result = await CycleService.tryStart(object.id)
      if ('cycle' in result) started += 1
    } catch (error) {
      logger.error({ error, objectId: object.id }, '[ProductionCycle] start failed')
    }
  }

  if (started || completed || failed) {
    logger.info({ started, completed, failed }, '[ProductionCycle] tick')
  }
  return { started, completed, failed }
}
