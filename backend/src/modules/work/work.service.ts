import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { withIdempotency } from '../../shared/db/idempotency'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { EconomyService } from '../economy/economy.service'
import { ResourcesService } from '../resources/resources.service'
import { calcFinalSalary, calcProductionExp, getProductionLevelFromExp } from './work.formulas'
const MAX_DAILY_SHIFTS = 8

function utcDayRange(now = new Date()) {
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { start, end }
}

export const WorkService = {
  async listObjects(characterId: string) {
    const { start, end } = utcDayRange()
    const [character, objects, used] = await Promise.all([
      prisma.character.findUniqueOrThrow({ where: { id: characterId } }),
      prisma.productionObject.findMany({ where: { isActive: true, status: 'ACTIVE' }, orderBy: { requiredProductionLevel: 'asc' } }),
      prisma.workShift.count({ where: { characterId, startedAt: { gte: start, lt: end } } }),
    ])
    // Клиенту нужен не код ресурса, а его название — иначе в таблице
    // выработки светится res_scrap_metal вместо «Металлолома».
    const templates = await prisma.resourceTemplate.findMany({ select: { code: true, name: true } })
    const names = new Map(templates.map(t => [t.code, t.name]))
    return {
      items: objects.map(x => ({
        ...x,
        producesResourceName: x.producesResourceCode ? names.get(x.producesResourceCode) ?? x.producesResourceCode : null,
        locked: character.productionLevel < x.requiredProductionLevel,
      })),
      daily: { shiftsUsedToday: used, shiftsLimit: MAX_DAILY_SHIFTS },
    }
  },
  async current(characterId: string) {
    const { start, end } = utcDayRange()
    const [shift, used] = await Promise.all([
      prisma.workShift.findFirst({ where: { characterId, status: { in: ['ACTIVE','READY_TO_CLAIM'] } }, include: { productionObject: true }, orderBy: { createdAt: 'desc' } }),
      prisma.workShift.count({ where: { characterId, startedAt: { gte: start, lt: end } } }),
    ])
    return { shift: shift ? { ...shift, isReady: shift.status === 'READY_TO_CLAIM' || shift.endsAt <= new Date(), remainingSeconds: Math.max(0, Math.ceil((shift.endsAt.getTime()-Date.now())/1000)) } : null, daily: { shiftsUsedToday: used, shiftsLimit: MAX_DAILY_SHIFTS } }
  },
  async start(characterId: string, productionObjectId: string) {
    return withTransaction(async tx => {
        const now = new Date()
        const { start, end } = utcDayRange(now)
        const [character, object, usedToday] = await Promise.all([
          tx.character.findUniqueOrThrow({ where: { id: characterId } }),
          tx.productionObject.findUnique({ where: { id: productionObjectId } }),
          tx.workShift.count({ where: { characterId, startedAt: { gte: start, lt: end } } }),
        ])
        if (usedToday >= MAX_DAILY_SHIFTS) throw new AppError(ErrorCode.WORK_DAILY_LIMIT, 'Daily shift limit reached', 400)
        if (!object?.isActive || object.status !== 'ACTIVE') throw new AppError(ErrorCode.WORK_OBJECT_NOT_FOUND, 'Production object unavailable', 400)
        if (character.productionLevel < object.requiredProductionLevel) throw new AppError(ErrorCode.WORK_LEVEL_REQUIRED, 'Production level too low', 400)
        if (character.status !== 'ACTIVE') throw new AppError(ErrorCode.WORK_CHARACTER_BUSY, 'Character is busy', 400)
        if (await tx.workShift.findFirst({ where: { characterId, status: { in: ['ACTIVE','READY_TO_CLAIM'] } } })) throw new AppError(ErrorCode.WORK_ACTIVE_SHIFT, 'Active shift already exists', 409)
        const slots = await tx.workShift.count({ where: { productionObjectId, status: 'ACTIVE' } })
        if (slots >= object.workerSlots) throw new AppError(ErrorCode.WORK_NO_SLOTS, 'No free worker slots', 409)
        const claimed = await tx.character.updateMany({ where: { id: characterId, status: 'ACTIVE' }, data: { status: 'WORKING' } })
        if (claimed.count !== 1) throw new AppError(ErrorCode.WORK_CHARACTER_BUSY, 'Character is busy', 409)
        const endsAt = new Date(now.getTime() + object.shiftDurationMinutes * 60_000)
        const shift = await tx.workShift.create({ data: { characterId, productionObjectId, status: 'ACTIVE', startedAt: now, endsAt, baseSalary: object.baseSalary } })
        await tx.productionLog.create({ data: { characterId, productionObjectId, eventType: 'SHIFT_STARTED', metadataJson: { shiftId: shift.id, endsAt } } })
        return { shift }
      })
  },
  async claim(characterId: string, shiftId: string, key: string) {
    return withIdempotency({ characterId, scope: 'work.shift.claim', key, execute: async tx => {
      let shift = await tx.workShift.findFirst({ where: { id: shiftId, characterId }, include: { productionObject: true } })
      if (!shift) throw new AppError(ErrorCode.CONFLICT, 'Shift not found', 404)
      if (shift.status === 'ACTIVE' && shift.endsAt <= new Date()) shift = await tx.workShift.update({ where: { id: shift.id }, data: { status: 'READY_TO_CLAIM' }, include: { productionObject: true } })
      if (shift.status !== 'READY_TO_CLAIM') throw new AppError(ErrorCode.WORK_NOT_READY, 'Shift is not ready', 400)
      const character = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
      if (!['ACTIVE', 'WORKING'].includes(character.status)) {
        throw new AppError(ErrorCode.WORK_CHARACTER_BUSY, 'Character is busy', 409)
      }
      const utcDayStart = new Date(shift.startedAt)
      utcDayStart.setUTCHours(0, 0, 0, 0)
      const utcDayEnd = new Date(utcDayStart)
      utcDayEnd.setUTCDate(utcDayEnd.getUTCDate() + 1)
      const dailyShiftNumber = await tx.workShift.count({
        where: { characterId, startedAt: { gte: utcDayStart, lt: utcDayEnd }, createdAt: { lte: shift.createdAt } },
      })
      const salary = calcFinalSalary(
        shift.baseSalary,
        shift.productionObject.level,
        character.productionLevel,
        Math.random(),
        dailyShiftNumber,
      )
      const productionExpGain = calcProductionExp(shift.productionObject.baseProductionExp, shift.productionObject.level)
      const productionExp = character.productionExp + productionExpGain
      const productionLevel = getProductionLevelFromExp(productionExp)
      const economicExpReward = shift.productionObject.economicExpReward
      const changed = await tx.workShift.updateMany({ where: { id: shift.id, status: 'READY_TO_CLAIM' }, data: { status: 'CLAIMED', claimedAt: new Date(), finalSalary: salary, productionExpReward: productionExpGain } })
      if (changed.count !== 1) throw new AppError(ErrorCode.WORK_ALREADY_CLAIMED, 'Shift already claimed', 409)
      const newBalance = await EconomyService.credit(tx, { characterId, amount: salary, reasonCode: 'WORK_SALARY', refType: 'work_shift', refId: shift.id })
      if (economicExpReward > 0) await EconomyService.grantEconomicExp(tx, characterId, economicExpReward)
      let resourceReward: { code: string; amount: number } | null = null
      if (shift.productionObject.producesResourceCode && shift.productionObject.outputAmountMax > 0) {
        const tpl = await tx.resourceTemplate.findUnique({ where: { code: shift.productionObject.producesResourceCode } })
        if (tpl) { const amount = Math.floor(Math.random()*(shift.productionObject.outputAmountMax-shift.productionObject.outputAmountMin+1))+shift.productionObject.outputAmountMin; await ResourcesService.add(tx,{characterId,resourceTemplateId:tpl.id,amount,reasonCode:'WORK_REWARD',refType:'work_shift',refId:shift.id}); resourceReward={code:tpl.code,amount} }
      }
      await tx.character.update({ where: { id: characterId }, data: { productionExp, productionLevel } })
      await tx.character.updateMany({ where: { id: characterId, status: 'WORKING' }, data: { status: 'ACTIVE' } })
      await tx.productionLog.create({ data: { characterId, productionObjectId: shift.productionObjectId, eventType: 'SHIFT_CLAIMED', metadataJson: { shiftId, salary, productionExpGain, resourceReward } } })
      return { shiftId, salary, productionExpGain, productionExp, productionLevel, resourceReward, newBalance }
    }})
  },
  async cancel(characterId: string, shiftId: string) {
    return withTransaction(async tx => {
      const shift = await tx.workShift.findFirst({ where: { id: shiftId, characterId, status: 'ACTIVE' } })
      if (!shift) throw new AppError(ErrorCode.CONFLICT, 'Active shift not found', 404)
      await tx.workShift.update({ where: { id: shift.id }, data: { status: 'CANCELLED' } })
      await tx.character.update({ where: { id: characterId }, data: { status: 'ACTIVE' } })
      await tx.productionLog.create({ data: { characterId, productionObjectId: shift.productionObjectId, eventType: 'SHIFT_CANCELLED', metadataJson: { shiftId } } })
      return { cancelled: true }
    })
  },
}
