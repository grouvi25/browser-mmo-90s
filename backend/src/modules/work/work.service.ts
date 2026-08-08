import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { withIdempotency } from '../../shared/db/idempotency'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { EconomyService } from '../economy/economy.service'
import { ResourcesService } from '../resources/resources.service'
import { calcFinalSalary, calcProductionExp } from './work.formulas'
import { PROFESSION_NAMES, professionLevelFromExp, type ProfessionCode } from '../professions/professions'

const MAX_DAILY_SHIFTS = 8

function utcDayRange(now = new Date()) {
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { start, end }
}

async function professionState(characterId: string, professionCode: string) {
  return prisma.characterProfession.findUnique({
    where: { characterId_professionCode: { characterId, professionCode } },
  })
}

export const WorkService = {
  async listObjects(characterId: string) {
    const { start, end } = utcDayRange()
    const [objects, used, professions, templates] = await Promise.all([
      prisma.productionObject.findMany({ where: { isActive: true, status: 'ACTIVE' }, orderBy: [{ requiredProfessionLevel: 'asc' }, { code: 'asc' }] }),
      prisma.workShift.count({ where: { characterId, startedAt: { gte: start, lt: end } } }),
      prisma.characterProfession.findMany({ where: { characterId } }),
      prisma.resourceTemplate.findMany({ select: { code: true, name: true } }),
    ])
    const professionByCode = new Map(professions.map(item => [item.professionCode, item]))
    const resourceNames = new Map(templates.map(item => [item.code, item.name]))
    return {
      items: objects.map(object => {
        const profession = professionByCode.get(object.requiredProfessionCode)
        const level = profession?.level ?? 0
        return {
          ...object,
          producesResourceName: object.producesResourceCode ? resourceNames.get(object.producesResourceCode) ?? object.producesResourceCode : null,
          profession: {
            code: object.requiredProfessionCode,
            name: PROFESSION_NAMES[object.requiredProfessionCode as ProfessionCode] ?? object.requiredProfessionCode,
            level,
            exp: profession?.exp ?? 0,
          },
          locked: level < object.requiredProfessionLevel,
        }
      }),
      professions: professions.map(item => ({
        ...item,
        name: PROFESSION_NAMES[item.professionCode as ProfessionCode] ?? item.professionCode,
      })),
      daily: { shiftsUsedToday: used, shiftsLimit: MAX_DAILY_SHIFTS },
    }
  },

  async current(characterId: string) {
    const { start, end } = utcDayRange()
    const [shift, used] = await Promise.all([
      prisma.workShift.findFirst({ where: { characterId, status: { in: ['ACTIVE', 'READY_TO_CLAIM'] } }, include: { productionObject: true }, orderBy: { createdAt: 'desc' } }),
      prisma.workShift.count({ where: { characterId, startedAt: { gte: start, lt: end } } }),
    ])
    const profession = shift ? await professionState(characterId, shift.professionCode) : null
    return {
      shift: shift ? {
        ...shift,
        profession: profession ? { ...profession, name: PROFESSION_NAMES[profession.professionCode as ProfessionCode] ?? profession.professionCode } : null,
        isReady: shift.status === 'READY_TO_CLAIM' || shift.endsAt <= new Date(),
        remainingSeconds: Math.max(0, Math.ceil((shift.endsAt.getTime() - Date.now()) / 1000)),
      } : null,
      daily: { shiftsUsedToday: used, shiftsLimit: MAX_DAILY_SHIFTS },
    }
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
      if (!object) throw new AppError(ErrorCode.WORK_OBJECT_NOT_FOUND, 'Production object not found', 404)
      if (!object.isActive || object.status !== 'ACTIVE') throw new AppError(ErrorCode.WORK_OBJECT_UNAVAILABLE, 'Production object unavailable', 409)
      const existingProfession = await tx.characterProfession.findUnique({
        where: { characterId_professionCode: { characterId, professionCode: object.requiredProfessionCode } },
      })
      if ((existingProfession?.level ?? 0) < object.requiredProfessionLevel) throw new AppError(ErrorCode.WORK_LEVEL_REQUIRED, 'Profession level too low', 400)
      if (character.status !== 'ACTIVE') throw new AppError(ErrorCode.WORK_CHARACTER_BUSY, 'Character is busy', 400)
      if (await tx.workShift.findFirst({ where: { characterId, status: { in: ['ACTIVE', 'READY_TO_CLAIM'] } } })) throw new AppError(ErrorCode.WORK_ACTIVE_SHIFT, 'Active shift already exists', 409)
      const slots = await tx.workShift.count({ where: { productionObjectId, status: 'ACTIVE' } })
      if (slots >= object.workerSlots) throw new AppError(ErrorCode.WORK_NO_SLOTS, 'No free worker slots', 409)
      const claimed = await tx.character.updateMany({ where: { id: characterId, status: 'ACTIVE' }, data: { status: 'WORKING' } })
      if (claimed.count !== 1) throw new AppError(ErrorCode.WORK_CHARACTER_BUSY, 'Character is busy', 409)
      const profession = existingProfession ?? await tx.characterProfession.create({ data: { characterId, professionCode: object.requiredProfessionCode } })
      const endsAt = new Date(now.getTime() + object.shiftDurationMinutes * 60_000)
      const shift = await tx.workShift.create({
        data: { characterId, productionObjectId, professionCode: object.requiredProfessionCode, status: 'ACTIVE', startedAt: now, endsAt, baseSalary: object.baseSalary },
      })
      await tx.productionLog.create({ data: { characterId, productionObjectId, eventType: 'SHIFT_STARTED', metadataJson: { shiftId: shift.id, endsAt, professionCode: shift.professionCode } } })
      return { shift, profession }
    })
  },

  async claim(characterId: string, shiftId: string, key: string) {
    return withIdempotency({ characterId, scope: 'work.shift.claim', key, execute: async tx => {
      let shift = await tx.workShift.findFirst({ where: { id: shiftId, characterId }, include: { productionObject: true } })
      if (!shift) throw new AppError(ErrorCode.WORK_SHIFT_NOT_FOUND, 'Shift not found', 404)
      if (shift.status === 'ACTIVE' && shift.endsAt <= new Date()) shift = await tx.workShift.update({ where: { id: shift.id }, data: { status: 'READY_TO_CLAIM' }, include: { productionObject: true } })
      if (shift.status !== 'READY_TO_CLAIM') throw new AppError(ErrorCode.WORK_NOT_READY, 'Shift is not ready', 400)
      const character = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
      if (!['ACTIVE', 'WORKING'].includes(character.status)) throw new AppError(ErrorCode.WORK_CHARACTER_BUSY, 'Character is busy', 409)
      const profession = await tx.characterProfession.upsert({
        where: { characterId_professionCode: { characterId, professionCode: shift.professionCode } }, update: {}, create: { characterId, professionCode: shift.professionCode },
      })
      const day = utcDayRange(shift.startedAt)
      const dailyShiftNumber = await tx.workShift.count({ where: { characterId, startedAt: { gte: day.start, lt: day.end }, createdAt: { lte: shift.createdAt } } })
      const salary = calcFinalSalary(shift.baseSalary, shift.productionObject.level, profession.level, Math.random(), dailyShiftNumber)
      const professionExpGain = calcProductionExp(shift.productionObject.baseProductionExp, shift.productionObject.level)
      const professionExp = profession.exp + professionExpGain
      const professionLevel = professionLevelFromExp(professionExp)
      const changed = await tx.workShift.updateMany({ where: { id: shift.id, status: 'READY_TO_CLAIM' }, data: { status: 'CLAIMED', claimedAt: new Date(), finalSalary: salary, professionExpReward: professionExpGain } })
      if (changed.count !== 1) throw new AppError(ErrorCode.WORK_ALREADY_CLAIMED, 'Shift already claimed', 409)
      const newBalance = await EconomyService.credit(tx, { characterId, amount: salary, reasonCode: 'WORK_SALARY', refType: 'work_shift', refId: shift.id })
      if (shift.productionObject.economicExpReward > 0) await EconomyService.grantEconomicExp(tx, characterId, shift.productionObject.economicExpReward)
      let resourceReward: { code: string; amount: number } | null = null
      if (shift.productionObject.producesResourceCode && shift.productionObject.outputAmountMax > 0) {
        const template = await tx.resourceTemplate.findUnique({ where: { code: shift.productionObject.producesResourceCode } })
        if (template) {
          const amount = Math.floor(Math.random() * (shift.productionObject.outputAmountMax - shift.productionObject.outputAmountMin + 1)) + shift.productionObject.outputAmountMin
          await ResourcesService.add(tx, { characterId, resourceTemplateId: template.id, amount, reasonCode: 'WORK_REWARD', refType: 'work_shift', refId: shift.id })
          resourceReward = { code: template.code, amount }
        }
      }
      await tx.characterProfession.update({ where: { id: profession.id }, data: { exp: professionExp, level: professionLevel } })
      const aggregate = await tx.characterProfession.aggregate({ where: { characterId }, _max: { level: true, exp: true } })
      await tx.character.update({ where: { id: characterId }, data: { status: 'ACTIVE', productionLevel: aggregate._max.level ?? professionLevel, productionExp: aggregate._max.exp ?? professionExp } })
      await tx.productionLog.create({ data: { characterId, productionObjectId: shift.productionObjectId, eventType: 'SHIFT_CLAIMED', metadataJson: { shiftId, salary, professionCode: shift.professionCode, professionExpGain, professionLevel, resourceReward } } })
      return { shiftId, salary, professionCode: shift.professionCode, professionExpGain, professionExp, professionLevel, resourceReward, newBalance }
    } })
  },

  async cancel(characterId: string, shiftId: string) {
    return withTransaction(async tx => {
      const shift = await tx.workShift.findFirst({ where: { id: shiftId, characterId, status: 'ACTIVE' } })
      if (!shift) throw new AppError(ErrorCode.WORK_SHIFT_NOT_FOUND, 'Active shift not found', 404)
      await tx.workShift.update({ where: { id: shift.id }, data: { status: 'CANCELLED' } })
      await tx.character.updateMany({ where: { id: characterId, status: 'WORKING' }, data: { status: 'ACTIVE' } })
      await tx.productionLog.create({ data: { characterId, productionObjectId: shift.productionObjectId, eventType: 'SHIFT_CANCELLED', metadataJson: { shiftId, professionCode: shift.professionCode } } })
      return { cancelled: true }
    })
  },
}
