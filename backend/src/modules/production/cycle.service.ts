import type { Prisma, ProductionCycleFailure, ResourceQuality } from '@prisma/client'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { ObjectInventoryService } from './inventory.service'
import { cycleDurationMinutes, cycleReady, equipmentWear, laborFromShift, outputQuality } from './cycle.formulas'

const ACTIVE_STATUSES = ['PENDING', 'RUNNING'] as const

function minimumQuality(qualities: ResourceQuality[]): ResourceQuality | null {
  if (qualities.length === 0) return null
  if (qualities.includes('POOR')) return 'POOR'
  if (qualities.includes('NORMAL')) return 'NORMAL'
  return 'FINE'
}

export const CycleService = {
  async tryStart(objectId: string) {
    try {
      return await withTransaction(async tx => {
        const object = await tx.productionObject.findUniqueOrThrow({
          where: { id: objectId },
          include: { equipment: true },
        })
        if (object.status === 'DAMAGED') return { failure: 'OBJECT_DAMAGED' as const }
        if (object.profileSwitchEndsAt) return { failure: 'PROFILE_SWITCHING' as const }
        if (object.durabilityCurrent <= 0) return { failure: 'EQUIPMENT_BROKEN' as const }
        if (object.ownerType !== 'SYSTEM' && object.balance < 0) return { failure: 'NEGATIVE_BALANCE' as const }
        if (!object.activeRecipeId) return { failure: 'INPUT_MISSING' as const }

        const active = await tx.productionCycle.count({
          where: { productionObjectId: objectId, status: { in: [...ACTIVE_STATUSES] } },
        })
        if (active > 0) return { alreadyRunning: true as const }

        const recipe = await tx.productionRecipe.findUniqueOrThrow({
          where: { id: object.activeRecipeId },
          include: { inputs: true },
        })
        const reservations = [] as Array<{
          inventoryId: string
          resourceCode: string
          quality: ResourceQuality
          amount: number
        }>
        for (const input of recipe.inputs) {
          const reserved = await ObjectInventoryService.reserve(tx, {
            objectId,
            resourceCode: input.resourceCode,
            minQuality: input.minQuality,
            amount: input.amount,
          })
          reservations.push({ ...reserved, resourceCode: input.resourceCode })
        }
        const cycle = await tx.productionCycle.create({
          data: {
            productionObjectId: objectId,
            recipeId: recipe.id,
            status: 'PENDING',
            laborRequired: recipe.laborRequired,
          },
        })
        if (reservations.length > 0) {
          await tx.cycleInputReservation.createMany({
            data: reservations.map(item => ({ cycleId: cycle.id, ...item })),
          })
        }
        await tx.productionLog.create({
          data: {
            characterId: object.ownerCharacterId,
            productionObjectId: objectId,
            eventType: 'CYCLE_STARTED',
            metadataJson: { cycleId: cycle.id, recipeCode: recipe.code, laborRequired: recipe.laborRequired },
          },
        })
        return { cycle }
      })
    } catch (error) {
      if (error instanceof AppError && error.code === ErrorCode.PROD_INPUT_MISSING) {
        return { failure: 'INPUT_MISSING' as const }
      }
      throw error
    }
  },

  async contributeLabor(tx: Prisma.TransactionClient, params: {
    objectId: string
    characterId: string
    workShiftId: string
    shiftDurationMinutes: number
    professionLevel: number
    workerEfficiency: number
    toolTier: number
  }) {
    const cycle = await tx.productionCycle.findFirst({
      where: { productionObjectId: params.objectId, status: { in: [...ACTIVE_STATUSES] } },
      orderBy: { createdAt: 'asc' },
      include: { recipe: true },
    })
    if (!cycle) return null
    const laborMinutes = laborFromShift(params.shiftDurationMinutes, params.workerEfficiency)
    await tx.cycleLaborContribution.create({
      data: {
        cycleId: cycle.id,
        characterId: params.characterId,
        workShiftId: params.workShiftId,
        laborMinutes,
        professionLevel: params.professionLevel,
        toolTier: params.toolTier,
      },
    })
    const updated = await tx.productionCycle.update({
      where: { id: cycle.id },
      data: { laborAccumulated: { increment: laborMinutes } },
    })
    if (updated.status === 'PENDING' && updated.laborAccumulated >= updated.laborRequired) {
      const minutes = cycleDurationMinutes(cycle.recipe.cycleMinutes, params.toolTier, cycle.recipe.requiredToolTier)
      const now = new Date()
      await tx.productionCycle.updateMany({
        where: { id: cycle.id, status: 'PENDING' },
        data: { status: 'RUNNING', startedAt: now, endsAt: new Date(now.getTime() + minutes * 60_000) },
      })
    }
    return {
      cycleId: cycle.id,
      laborMinutes,
      laborAccumulated: updated.laborAccumulated,
      laborRequired: updated.laborRequired,
    }
  },

  async complete(cycleId: string) {
    return withTransaction(async tx => {
      const current = await tx.productionCycle.findUniqueOrThrow({
        where: { id: cycleId },
        include: {
          recipe: true,
          contributions: true,
          inputReservations: true,
          productionObject: true,
        },
      })
      if (current.status !== 'RUNNING') return { alreadyClosed: true as const }
      if (!cycleReady({
        laborAccumulated: current.laborAccumulated,
        laborRequired: current.laborRequired,
        endsAt: current.endsAt,
        now: new Date(),
      })) return { notReady: true as const }

      const claimed = await tx.productionCycle.updateMany({
        where: { id: cycleId, status: 'RUNNING' },
        data: { status: 'COMPLETED', completedAt: new Date() },
      })
      if (claimed.count !== 1) return { alreadyClosed: true as const }

      for (const reservation of current.inputReservations) {
        await ObjectInventoryService.consumeReserved(tx, reservation.inventoryId, reservation.amount)
      }
      const best = current.contributions.reduce(
        (value, item) => ({
          professionLevel: Math.max(value.professionLevel, item.professionLevel),
          toolTier: Math.max(value.toolTier, item.toolTier),
        }),
        { professionLevel: 0, toolTier: 0 },
      )
      const quality = outputQuality({
        professionLevel: best.professionLevel,
        toolTier: best.toolTier,
        requiredToolTier: current.recipe.requiredToolTier,
        minInputQuality: minimumQuality(current.inputReservations.map(item => item.quality)),
      })
      if (current.recipe.outputResourceCode) {
        await ObjectInventoryService.put(tx, {
          objectId: current.productionObjectId,
          resourceCode: current.recipe.outputResourceCode,
          quality,
          amount: current.recipe.outputAmount,
          capacity: current.productionObject.storageCapacity,
        })
      } else if (current.recipe.outputItemTemplateCode) {
        if (!current.productionObject.ownerCharacterId) {
          throw new AppError(ErrorCode.PROD_CYCLE_BLOCKED, 'Для выпуска предмета нужен владелец объекта', 409)
        }
        const template = await tx.itemTemplate.findUniqueOrThrow({
          where: { code: current.recipe.outputItemTemplateCode },
        })
        for (let index = 0; index < current.recipe.outputAmount; index += 1) {
          await tx.itemInstance.create({
            data: {
              templateId: template.id,
              ownerId: current.productionObject.ownerCharacterId,
              quality: template.qualityBase,
              durabilityCurrent: template.durabilityMax,
              durabilityMax: template.durabilityMax,
              weight: template.weight,
              sourceType: 'CRAFTED',
            },
          })
        }
      }
      await tx.productionObject.update({
        where: { id: current.productionObjectId },
        data: {
          durabilityCurrent: { decrement: Math.min(equipmentWear(), current.productionObject.durabilityCurrent) },
        },
      })
      await tx.productionCycle.update({ where: { id: cycleId }, data: { outputQuality: quality } })
      await tx.productionLog.create({
        data: {
          characterId: current.productionObject.ownerCharacterId,
          productionObjectId: current.productionObjectId,
          eventType: 'CYCLE_COMPLETED',
          metadataJson: { cycleId, quality, contributors: current.contributions.length },
        },
      })
      return { completed: true as const, quality }
    })
  },

  async fail(cycleId: string, reason: ProductionCycleFailure) {
    return withTransaction(async tx => {
      const claimed = await tx.productionCycle.updateMany({
        where: { id: cycleId, status: { in: [...ACTIVE_STATUSES] } },
        data: { status: 'FAILED', failureReason: reason },
      })
      if (claimed.count !== 1) return { alreadyClosed: true as const }
      const cycle = await tx.productionCycle.findUniqueOrThrow({
        where: { id: cycleId },
        include: { inputReservations: true },
      })
      for (const reservation of cycle.inputReservations) {
        await ObjectInventoryService.releaseReserved(tx, reservation.inventoryId, reservation.amount)
      }
      await tx.productionLog.create({
        data: {
          productionObjectId: cycle.productionObjectId,
          eventType: 'CYCLE_FAILED',
          metadataJson: { cycleId, reason },
        },
      })
      return { failed: true as const }
    })
  },
}
