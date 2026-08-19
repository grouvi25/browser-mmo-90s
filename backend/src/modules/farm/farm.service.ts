import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { EconomyService } from '../economy/economy.service'
import { ResourcesService } from '../resources/resources.service'
import { CROPS, FARM_MAX_PLOTS, FARM_MAX_WATERS, FARM_WATER_COOLDOWN_MINUTES, type CropCode, harvestAmount, initialFarmTimers, plotPrice, wateredReadyAt } from './farm.formulas'

async function professionLevel(characterId: string): Promise<number> {
  const row = await prisma.characterProfession.findUnique({
    where: { characterId_professionCode: { characterId, professionCode: 'procurer' } },
  })
  return row?.level ?? 0
}

export const FarmService = {
  async list(characterId: string) {
    await prisma.farmPlot.upsert({
      where: { characterId_slot: { characterId, slot: 1 } },
      update: {}, create: { characterId, slot: 1 },
    })
    const [plots, level] = await Promise.all([
      prisma.farmPlot.findMany({ where: { characterId }, orderBy: { slot: 'asc' } }),
      professionLevel(characterId),
    ])
    const now = new Date()
    return {
      plots: plots.map(plot => ({
        ...plot,
        state: !plot.cropCode ? 'EMPTY' : plot.withersAt && plot.withersAt <= now ? 'WITHERED' : plot.readyAt && plot.readyAt <= now ? 'READY' : 'GROWING',
      })),
      crops: Object.entries(CROPS).map(([code, crop]) => ({ code, ...crop, available: level >= crop.requiredLevel })),
      professionLevel: level,
      nextPlotPrice: plots.length < FARM_MAX_PLOTS ? plotPrice(plots.length + 1) : null,
    }
  },

  async buyPlot(characterId: string) {
    return withTransaction(async tx => {
      const count = await tx.farmPlot.count({ where: { characterId } })
      const slot = Math.max(1, count + 1)
      if (slot > FARM_MAX_PLOTS) throw new AppError(ErrorCode.FARM_PLOT_LIMIT, 'Farm plot limit reached', 409)
      const cost = plotPrice(slot)
      let newBalance: number | undefined
      if (cost > 0) newBalance = await EconomyService.debit(tx, { characterId, amount: cost, reasonCode: 'FARM_PLOT_PURCHASE', refType: 'farm_plot', refId: String(slot) })
      const plot = await tx.farmPlot.create({ data: { characterId, slot } })
      return { plot, cost, newBalance }
    })
  },

  async plant(characterId: string, plotId: string, cropCode: CropCode) {
    const crop = CROPS[cropCode]
    if (!crop) throw new AppError(ErrorCode.FARM_CROP_INVALID, 'Unknown crop', 422)
    return withTransaction(async tx => {
      const plot = await tx.farmPlot.findFirst({ where: { id: plotId, characterId } })
      if (!plot) throw new AppError(ErrorCode.FARM_PLOT_EMPTY, 'Farm plot not found', 404)
      if (plot.cropCode) throw new AppError(ErrorCode.FARM_PLOT_BUSY, 'Farm plot is occupied', 409)
      const profession = await tx.characterProfession.findUnique({ where: { characterId_professionCode: { characterId, professionCode: 'procurer' } } })
      const level = profession?.level ?? 0
      if (level < crop.requiredLevel) throw new AppError(ErrorCode.FARM_CROP_INVALID, 'Profession level is too low', 403, { requiredLevel: crop.requiredLevel })
      const newBalance = await EconomyService.debit(tx, { characterId, amount: crop.seedPrice, reasonCode: 'FARM_SEED_PURCHASE', refType: 'farm_plot', refId: plotId })
      const timers = initialFarmTimers(cropCode, level)
      const updated = await tx.farmPlot.update({ where: { id: plotId }, data: { cropCode, ...timers, waterCount: 0, lastWateredAt: null } })
      return { plot: updated, newBalance }
    })
  },

  async water(characterId: string, plotId: string) {
    return withTransaction(async tx => {
      const plot = await tx.farmPlot.findFirst({ where: { id: plotId, characterId } })
      if (!plot?.cropCode || !plot.readyAt) throw new AppError(ErrorCode.FARM_PLOT_EMPTY, 'Nothing is planted here', 409)
      const now = new Date()
      if (plot.readyAt <= now) throw new AppError(ErrorCode.FARM_NOT_READY, 'Crop has already matured', 409)
      if (plot.waterCount >= FARM_MAX_WATERS) throw new AppError(ErrorCode.FARM_WATER_LIMIT, 'Watering limit reached', 409)
      if (plot.lastWateredAt && now.getTime() - plot.lastWateredAt.getTime() < FARM_WATER_COOLDOWN_MINUTES * 60_000) {
        throw new AppError(ErrorCode.FARM_WATER_COOLDOWN, 'Watering is on cooldown', 409)
      }
      const readyAt = wateredReadyAt(plot.readyAt, now)
      return tx.farmPlot.update({ where: { id: plotId }, data: { readyAt, waterCount: { increment: 1 }, lastWateredAt: now } })
    })
  },

  async harvest(characterId: string, plotId: string) {
    return withTransaction(async tx => {
      const plot = await tx.farmPlot.findFirst({ where: { id: plotId, characterId } })
      if (!plot?.cropCode || !plot.readyAt || !plot.withersAt) throw new AppError(ErrorCode.FARM_PLOT_EMPTY, 'Nothing is planted here', 409)
      const now = new Date()
      if (plot.withersAt <= now) throw new AppError(ErrorCode.FARM_CROP_WITHERED, 'Crop has withered', 409)
      if (plot.readyAt > now) throw new AppError(ErrorCode.FARM_NOT_READY, 'Crop is not ready', 409)
      const cropCode = plot.cropCode as CropCode
      const crop = CROPS[cropCode]
      if (!crop) throw new AppError(ErrorCode.FARM_CROP_INVALID, 'Unknown crop', 422)
      const amount = harvestAmount(cropCode)
      const resource = await tx.resourceTemplate.findUniqueOrThrow({ where: { code: crop.resourceCode } })
      await ResourcesService.add(tx, { characterId, resourceTemplateId: resource.id, amount, reasonCode: 'FARM_HARVEST', refType: 'farm_plot', refId: plotId })
      await tx.farmPlot.update({ where: { id: plotId }, data: { cropCode: null, plantedAt: null, readyAt: null, withersAt: null, waterCount: 0, lastWateredAt: null } })
      return { cropCode, resourceCode: crop.resourceCode, amount }
    })
  },
}
