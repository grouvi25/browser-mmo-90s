import { prisma } from '../../shared/db/prisma'
import { getRedis } from '../../shared/db/redis'
import { logger } from '../../shared/logger/logger'
import { workToolBlockedKey } from '../../workers/economy-metrics.formulas'
import { withTransaction } from '../../shared/db/transaction'
import { withIdempotency } from '../../shared/db/idempotency'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { EconomyService } from '../economy/economy.service'
import { ResourcesService } from '../resources/resources.service'
import { admissionRequirement, calcFinalSalary, calcProductionExp, fitsDailyBudget, shiftMinutes, workerEfficiency } from './work.formulas'
import { CycleService } from '../production/cycle.service'
import { BalanceConfig } from '../../config/balance.config'
import { PremiumService } from '../premium/premium.service'
import { PROFESSION_NAMES, professionLevelFromExp, type ProfessionCode } from '../professions/professions'

const MAX_DAILY_SHIFTS = BalanceConfig.economy.work.dailyShiftLimit
const WORK_LIMITS = BalanceConfig.economy.work
const MAX_DAILY_MINUTES = BalanceConfig.economy.work.dailyShiftMinutes

async function recordMissingToolBlock(now: Date): Promise<void> {
  try {
    const key = workToolBlockedKey(now.toISOString().slice(0, 10))
    const redis = getRedis()
    await redis.incr(key)
    await redis.expire(key, 40 * 24 * 60 * 60)
  } catch (err) {
    logger.warn({ err }, '[WorkMetrics] Failed to record missing-tool block')
  }
}

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
    const [objects, used, professions, templates, tools] = await Promise.all([
      prisma.productionObject.findMany({ where: { isActive: true, status: 'ACTIVE' }, include: { equipment: true }, orderBy: [{ requiredProfessionLevel: 'asc' }, { code: 'asc' }] }),
      prisma.workShift.findMany({ where: { characterId, helperId: null, startedAt: { gte: start, lt: end } }, select: { startedAt: true, endsAt: true } }),
      prisma.characterProfession.findMany({ where: { characterId } }),
      prisma.resourceTemplate.findMany({ select: { code: true, name: true } }),
      prisma.itemInstance.findMany({ where: { ownerId: characterId, status: 'NORMAL', usesLeft: { gt: 0 }, template: { type: 'TOOL' } }, include: { template: true } }),
    ])
    const ownerIds = [...new Set(objects.map(object => object.ownerCharacterId).filter((id): id is string => !!id))]
    const owners = ownerIds.length ? await prisma.character.findMany({ where: { id: { in: ownerIds } }, select: { id: true, nickname: true } }) : []
    const ownerNames = new Map(owners.map(item => [item.id, item.nickname]))
    const dailyCap = await PremiumService.dailyShiftCap(characterId)
    const professionByCode = new Map(professions.map(item => [item.professionCode, item]))
    const resourceNames = new Map(templates.map(item => [item.code, item.name]))
    const premiumRecipes = await prisma.productionRecipe.findMany({ where: { requiredToolCode: { not: null } }, select: { id: true, requiredToolCode: true } })
    const toolOf = (recipeId: string | null) => premiumRecipes.find(recipe => recipe.id === recipeId)?.requiredToolCode ?? null
    const toolNames = new Map((await prisma.itemTemplate.findMany({
      where: { code: { in: premiumRecipes.map(recipe => recipe.requiredToolCode as string) } }, select: { code: true, name: true },
    })).map(item => [item.code, item.name]))
    // Цех книги без владельца не платит и ничего не даёт: вакансии там нет.
    const vacancies = objects.filter(object => object.ownerType !== 'SYSTEM' || object.baseSalary > 0 || object.producesResourceCode)
    return {
      items: vacancies.map(object => {
        const profession = professionByCode.get(object.requiredProfessionCode)
        const level = profession?.level ?? 0
        // Замок считается по предыдущему переделу — по нему же строится
        // подпись, иначе игрок видит требование к профессии, которой у него
        // ещё нет и взять её негде.
        const admission = admissionRequirement(object)
        const gateLevel = admission ? professionByCode.get(admission.professionCode)?.level ?? 0 : 0
        return {
          ...object,
          offeredSalary: object.salaryOverride ?? object.baseSalary,
          // Частный завод (обещание игрокам 23.10): платит владелец из кассы
          // объекта, сырьё со смены уходит ему. Работнику видно, чей это
          // завод и хватит ли в кассе на его зарплату.
          employer: object.ownerType === 'PRIVATE' && object.ownerCharacterId ? {
            nickname: ownerNames.get(object.ownerCharacterId) ?? null,
            isMe: object.ownerCharacterId === characterId,
            canPay: object.ownerCharacterId === characterId || object.balance >= (object.salaryOverride ?? object.baseSalary),
          } : null,
          producesResourceName: object.producesResourceCode ? resourceNames.get(object.producesResourceCode) ?? object.producesResourceCode : null,
          profession: {
            code: object.requiredProfessionCode,
            name: PROFESSION_NAMES[object.requiredProfessionCode as ProfessionCode] ?? object.requiredProfessionCode,
            level,
            exp: profession?.exp ?? 0,
            // Без изученной в Училище профессии смена не начнётся (WORK_013).
            learned: !!profession,
          },
          admission: admission ? {
            professionCode: admission.professionCode,
            professionName: PROFESSION_NAMES[admission.professionCode as ProfessionCode] ?? admission.professionCode,
            requiredLevel: admission.level,
            currentLevel: gateLevel,
          } : null,
          locked: admission ? gateLevel < admission.level : false,
          equipment: object.equipment,
          toolAvailable: toolOf(object.activeRecipeId)
            ? tools.some(tool => tool.template.code === toolOf(object.activeRecipeId))
            : !object.equipment || tools.some(tool => (tool.template.toolTier ?? 0) >= object.equipment!.requiredToolTier),
          requiredToolName: toolOf(object.activeRecipeId) ? toolNames.get(toolOf(object.activeRecipeId)!) ?? null : null,
        }
      }),
      professions: professions.map(item => ({
        ...item,
        code: item.professionCode,
        name: PROFESSION_NAMES[item.professionCode as ProfessionCode] ?? item.professionCode,
      })),
      // Лимиты показываются подписчицкие: экран, обещающий 12 смен тому,
      // у кого их 16, врёт ровно там, где игрок за это заплатил.
      daily: {
        shiftsUsedToday: used.length,
        shiftsLimit: dailyCap,
        minutesUsedToday: shiftMinutes(used),
        minutesLimit: Math.round(MAX_DAILY_MINUTES * (dailyCap / MAX_DAILY_SHIFTS)),
      },
    }
  },

  async current(characterId: string) {
    const { start, end } = utcDayRange()
    const [shift, used] = await Promise.all([
      prisma.workShift.findFirst({ where: { characterId, helperId: null, status: { in: ['ACTIVE', 'READY_TO_CLAIM'] } }, include: { productionObject: { include: { equipment: true } }, toolInstance: { include: { template: true } } }, orderBy: { createdAt: 'desc' } }),
      prisma.workShift.findMany({ where: { characterId, helperId: null, startedAt: { gte: start, lt: end } }, select: { startedAt: true, endsAt: true } }),
    ])
    const profession = shift ? await professionState(characterId, shift.professionCode) : null
    const dailyCap = await PremiumService.dailyShiftCap(characterId)
    return {
      shift: shift ? {
        ...shift,
        profession: profession ? { ...profession, name: PROFESSION_NAMES[profession.professionCode as ProfessionCode] ?? profession.professionCode } : null,
        isReady: shift.status === 'READY_TO_CLAIM' || shift.endsAt <= new Date(),
        remainingSeconds: Math.max(0, Math.ceil((shift.endsAt.getTime() - Date.now()) / 1000)),
      } : null,
      // Лимиты показываются подписчицкие: экран, обещающий 12 смен тому,
      // у кого их 16, врёт ровно там, где игрок за это заплатил.
      daily: {
        shiftsUsedToday: used.length,
        shiftsLimit: dailyCap,
        minutesUsedToday: shiftMinutes(used),
        minutesLimit: Math.round(MAX_DAILY_MINUTES * (dailyCap / MAX_DAILY_SHIFTS)),
      },
    }
  },

  async start(characterId: string, productionObjectId: string) {
    return withTransaction(async tx => {
      const now = new Date()
      const { start, end } = utcDayRange(now)
      const [character, object, todayShifts] = await Promise.all([
        tx.character.findUniqueOrThrow({ where: { id: characterId } }),
        tx.productionObject.findUnique({ where: { id: productionObjectId }, include: { equipment: true } }),
        // helperId: null — только собственные смены игрока. Смены
        // помощника висят на том же characterId, но суточный лимит
        // хозяина не расходуют: помощник работает вместо него, а не
        // вместо его же дня.
        tx.workShift.findMany({ where: { characterId, helperId: null, startedAt: { gte: start, lt: end } }, select: { startedAt: true, endsAt: true } }),
      ])
      // Подписка поднимает ВЕРХНЮЮ ГРАНИЦУ дня, а не эффективность часа:
      // подписчик может работать дольше, но не зарабатывает больше в час,
      // и усталость зарплаты Этапа 2 продолжает действовать на все смены.
      const shiftCap = await PremiumService.dailyShiftCap(characterId)
      if (todayShifts.length >= shiftCap) throw new AppError(ErrorCode.WORK_DAILY_LIMIT, 'Daily shift limit reached', 400)
      if (!object) throw new AppError(ErrorCode.WORK_OBJECT_NOT_FOUND, 'Production object not found', 404)
      // Бюджет минут растёт вместе с потолком смен.
      //
      // Иначе премиальные шестнадцать смен не значат НИЧЕГО: fitsDailyBudget
      // с настройками по умолчанию режет подписчика теми же двенадцатью
      // сменами и тремястами шестьюдесятью минутами, что и всех. Дефект
      // нашёл сквозной прогон Этапа 5: подписчик зарабатывал ровно столько
      // же, сколько бесплатный игрок, при заявленных 16 сменах.
      //
      // Пропорция, а не отдельное число: подписка покупает время, и растёт
      // всё время целиком, а не число смен в отрыве от минут.
      const minuteBudget = Math.round(
        WORK_LIMITS.dailyShiftMinutes * (shiftCap / WORK_LIMITS.dailyShiftLimit))
      if (!fitsDailyBudget(todayShifts.length, shiftMinutes(todayShifts), object.shiftDurationMinutes,
        { shifts: shiftCap, minutes: minuteBudget })) {
        throw new AppError(ErrorCode.WORK_DAILY_LIMIT, 'Daily shift budget reached', 400)
      }
      if (!object.isActive || object.status !== 'ACTIVE') throw new AppError(ErrorCode.WORK_OBJECT_UNAVAILABLE, 'Production object unavailable', 409)
      const existingProfession = await tx.characterProfession.findUnique({
        where: { characterId_professionCode: { characterId, professionCode: object.requiredProfessionCode } },
      })
      // Правка заказчика: профессии покупаются в Училище. Раньше первая смена
      // выдавала профессию даром, и покупка в Училище ничего не давала.
      if (!existingProfession) {
        const name = PROFESSION_NAMES[object.requiredProfessionCode as ProfessionCode] ?? object.requiredProfessionCode
        throw new AppError(ErrorCode.WORK_PROFESSION_REQUIRED, `Сначала изучите профессию «${name}» в Училище`, 403)
      }
      // Допуск — по предыдущему переделу направления, а не по профессии
      // самого объекта: её опыт нигде, кроме этого объекта, не начисляется.
      const admission = admissionRequirement(object)
      if (admission) {
        const gate = await tx.characterProfession.findUnique({
          where: { characterId_professionCode: { characterId, professionCode: admission.professionCode } },
        })
        if ((gate?.level ?? 0) < admission.level) throw new AppError(ErrorCode.WORK_LEVEL_REQUIRED, 'Profession level too low', 400)
      }
      if (character.status !== 'ACTIVE') throw new AppError(ErrorCode.WORK_CHARACTER_BUSY, 'Character is busy', 400)
      // Тоже только свои: занятый помощник не должен запирать хозяина.
      if (await tx.workShift.findFirst({ where: { characterId, helperId: null, status: { in: ['ACTIVE', 'READY_TO_CLAIM'] } } })) throw new AppError(ErrorCode.WORK_ACTIVE_SHIFT, 'Active shift already exists', 409)
      // Отдых после смены, одинаковый для всех объектов (правка заказчика
      // 20.10: «после работы паузы должны быть… 30 минут, потом поправим»).
      // Считаем от КОНЦА работы, а не от того, когда смену забрали (правка
      // 24.10: «поставил работать, 30 минут работаешь, 30 минут отдыха — и
      // через час можно снова»). Смены помощника хозяина не держат.
      const restMs = WORK_LIMITS.restMinutesAfterShift * 60_000
      const lastEnded = await tx.workShift.findFirst({
        where: { characterId, helperId: null, status: 'CLAIMED', endsAt: { gt: new Date(Date.now() - restMs) } },
        orderBy: { endsAt: 'desc' }, select: { endsAt: true },
      })
      if (lastEnded) {
        const restUntil = new Date(lastEnded.endsAt.getTime() + restMs)
        const left = Math.max(1, Math.ceil((restUntil.getTime() - Date.now()) / 60_000))
        throw new AppError(ErrorCode.WORK_RESTING, `Отдых после смены: следующую можно начать через ${left} мин`, 409, { restUntil: restUntil.toISOString() })
      }
      // Частный завод платит из своей кассы. Раньше смена начиналась и при
      // пустой кассе, зарплата бралась из воздуха, а владельцу копился долг.
      if (object.ownerType === 'PRIVATE' && object.ownerCharacterId !== characterId
        && object.balance < (object.salaryOverride ?? object.baseSalary)) {
        throw new AppError(ErrorCode.WORK_EMPLOYER_NO_MONEY, 'У владельца завода нет денег на зарплату — выберите другую работу', 409)
      }
      const slots = await tx.workShift.count({ where: { productionObjectId, status: 'ACTIVE' } })
      if (slots >= object.workerSlots) throw new AppError(ErrorCode.WORK_NO_SLOTS, 'No free worker slots', 409)
      const claimed = await tx.character.updateMany({ where: { id: characterId, status: 'ACTIVE' }, data: { status: 'WORKING' } })
      if (claimed.count !== 1) throw new AppError(ErrorCode.WORK_CHARACTER_BUSY, 'Character is busy', 409)
      const profession = existingProfession
      let toolInstanceId: string | null = null
      // Рецепт под премиальный инструмент (заказчик 30.10): подходит только свой.
      const recipe = object.activeRecipeId
        ? await tx.productionRecipe.findUnique({ where: { id: object.activeRecipeId }, select: { requiredToolCode: true } })
        : null
      const toolCode = recipe?.requiredToolCode ?? null
      if (object.equipment?.isActive || toolCode) {
        const candidates = await tx.itemInstance.findMany({
          where: { ownerId: characterId, status: 'NORMAL', usesLeft: { gt: 0 }, template: toolCode ? { type: 'TOOL', code: toolCode } : { type: 'TOOL', toolTier: { gte: object.equipment?.requiredToolTier ?? 1 } } },
          include: { template: true }, orderBy: { createdAt: 'asc' },
        })
        candidates.sort((a, b) => (a.template.toolTier ?? 0) - (b.template.toolTier ?? 0))
        for (const candidate of candidates) {
          const locked = await tx.itemInstance.updateMany({ where: { id: candidate.id, ownerId: characterId, status: 'NORMAL', usesLeft: { gt: 0 } }, data: { status: 'LOCKED' } })
          if (locked.count === 1) { toolInstanceId = candidate.id; break }
        }
        if (!toolInstanceId) {
          await recordMissingToolBlock(now)
          if (toolCode) {
            const tool = await tx.itemTemplate.findUnique({ where: { code: toolCode }, select: { name: true } })
            throw new AppError(ErrorCode.WORK_TOOL_REQUIRED, `Для этого рецепта нужен инструмент: ${tool?.name ?? toolCode}`, 400)
          }
          throw new AppError(ErrorCode.WORK_TOOL_REQUIRED, `Tool tier ${object.equipment?.requiredToolTier ?? 1} with remaining uses is required`, 400)
        }
      }
      const endsAt = new Date(now.getTime() + object.shiftDurationMinutes * 60_000)
      const shift = await tx.workShift.create({
        data: { characterId, productionObjectId, professionCode: object.requiredProfessionCode, status: 'ACTIVE', startedAt: now, endsAt, baseSalary: object.salaryOverride ?? object.baseSalary, toolInstanceId },
      })
      await tx.productionLog.create({ data: { characterId, productionObjectId, eventType: 'SHIFT_STARTED', metadataJson: { shiftId: shift.id, endsAt, professionCode: shift.professionCode, toolInstanceId } } })
      return { shift, profession }
    })
  },

  async claim(characterId: string, shiftId: string, key: string) {
    return withIdempotency({ characterId, scope: 'work.shift.claim', key, execute: async tx => {
      // helperId: null обязателен: без него игрок забирал бы смену
      // помощника этой ручкой и получал полную зарплату и опыт себе,
      // минуя множитель 0.6 и профессию помощника.
      let shift = await tx.workShift.findFirst({ where: { id: shiftId, characterId, helperId: null }, include: { productionObject: true, toolInstance: { include: { template: true } } } })
      if (!shift) throw new AppError(ErrorCode.WORK_SHIFT_NOT_FOUND, 'Shift not found', 404)
      if (shift.status === 'ACTIVE' && shift.endsAt <= new Date()) shift = await tx.workShift.update({ where: { id: shift.id }, data: { status: 'READY_TO_CLAIM' }, include: { productionObject: true, toolInstance: { include: { template: true } } } })
      if (shift.status !== 'READY_TO_CLAIM') throw new AppError(ErrorCode.WORK_NOT_READY, 'Shift is not ready', 400)
      const character = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
      if (!['ACTIVE', 'WORKING'].includes(character.status)) throw new AppError(ErrorCode.WORK_CHARACTER_BUSY, 'Character is busy', 409)
      // upsert остаётся ради смен, начатых до того, как профессии стали
      // платными: новую смену без изученной профессии start уже не откроет.
      const profession = await tx.characterProfession.upsert({
        where: { characterId_professionCode: { characterId, professionCode: shift.professionCode } }, update: {}, create: { characterId, professionCode: shift.professionCode },
      })
      const day = utcDayRange(shift.startedAt)
      // Усталость считается по СВОИМ сменам: смены помощника не должны
      // душить зарплату хозяина, у помощника усталость своя.
      const dailyShiftNumber = await tx.workShift.count({ where: { characterId, helperId: null, startedAt: { gte: day.start, lt: day.end }, createdAt: { lte: shift.createdAt } } })
      const salary = calcFinalSalary(shift.baseSalary, shift.productionObject.level, profession.level, Math.random(), dailyShiftNumber)
      const professionExpGain = calcProductionExp(shift.productionObject.baseProductionExp, shift.productionObject.level)
      const professionExp = profession.exp + professionExpGain
      const professionLevel = professionLevelFromExp(professionExp)
      const changed = await tx.workShift.updateMany({ where: { id: shift.id, status: 'READY_TO_CLAIM' }, data: { status: 'CLAIMED', claimedAt: new Date(), finalSalary: salary, professionExpReward: professionExpGain } })
      if (changed.count !== 1) throw new AppError(ErrorCode.WORK_ALREADY_CLAIMED, 'Shift already claimed', 409)
      let toolUse: { itemId: string; usesLeft: number } | null = null
      if (shift.toolInstanceId) {
        const consumed = await tx.itemInstance.updateMany({ where: { id: shift.toolInstanceId, ownerId: characterId, status: 'LOCKED', usesLeft: { gt: 0 } }, data: { usesLeft: { decrement: 1 } } })
        if (consumed.count !== 1) throw new AppError(ErrorCode.WORK_TOOL_UNAVAILABLE, 'Reserved tool is unavailable', 409)
        const tool = await tx.itemInstance.findUniqueOrThrow({ where: { id: shift.toolInstanceId } })
        const usesLeft = tool.usesLeft ?? 0
        await tx.itemInstance.update({ where: { id: tool.id }, data: { status: usesLeft <= 0 ? 'CONSUMED' : 'NORMAL' } })
        await tx.itemLog.create({ data: { itemId: tool.id, characterId, actionCode: 'TOOL_USE', details: { shiftId, usesLeft } } })
        toolUse = { itemId: tool.id, usesLeft }
      }
      const privatelyOwned = shift.productionObject.ownerType !== 'SYSTEM'
      if (privatelyOwned) {
        const paid = await tx.productionObject.updateMany({
          where: { id: shift.productionObjectId, balance: { gte: salary } },
          data: { balance: { decrement: salary } },
        })
        if (paid.count !== 1) {
          await tx.productionObject.update({
            where: { id: shift.productionObjectId },
            data: { maintenanceDebt: { increment: salary } },
          })
        }
      }
      // Смена без оклада платит продукцией: начислять нечего.
      const newBalance = salary > 0 ? await EconomyService.credit(tx, {
        characterId,
        amount: salary,
        reasonCode: privatelyOwned ? 'SALARY_FROM_OBJECT' : 'WORK_SALARY',
        refType: 'work_shift',
        refId: shift.id,
      }) : (await tx.character.findUniqueOrThrow({ where: { id: characterId }, select: { money: true } })).money
      if (shift.productionObject.economicExpReward > 0) await EconomyService.grantEconomicExp(tx, characterId, shift.productionObject.economicExpReward)
      const cycleContribution = shift.productionObject.activeRecipeId
        ? await CycleService.contributeLabor(tx, {
          objectId: shift.productionObjectId,
          characterId,
          workShiftId: shift.id,
          shiftDurationMinutes: Math.round((shift.endsAt.getTime() - shift.startedAt.getTime()) / 60_000),
          professionLevel: profession.level,
          workerEfficiency: workerEfficiency(profession.level),
          toolTier: shift.toolInstance?.template.toolTier ?? 0,
        })
        : null
      // Сырьё объекта работник получает всегда, и на объекте с рецептом тоже:
      // раньше рецепт забирал смену целиком в цикл владельца, и игрок после
      // работы оставался без ресурсов (правка заказчика 20.10). Трудочасы
      // в цикл владельца при этом идут, как и раньше.
      //
      // Частный завод — иначе (обещание игрокам 23.10: «на работу устраиваются
      // игроки, получают зарплату, а владелец завода получает ресурсы»):
      // сырьё уходит владельцу, работнику — зарплата. Своя смена владельца на
      // своём заводе — ему же.
      let resourceReward: { code: string; amount: number } | null = null
      let resourceToOwner: { code: string; amount: number } | null = null
      if (shift.productionObject.producesResourceCode && shift.productionObject.outputAmountMax > 0) {
        const template = await tx.resourceTemplate.findUnique({ where: { code: shift.productionObject.producesResourceCode } })
        if (template) {
          const amount = Math.floor(Math.random() * (shift.productionObject.outputAmountMax - shift.productionObject.outputAmountMin + 1)) + shift.productionObject.outputAmountMin
          const owner = shift.productionObject.ownerType === 'PRIVATE' ? shift.productionObject.ownerCharacterId : null
          if (owner && owner !== characterId) {
            await ResourcesService.add(tx, { characterId: owner, resourceTemplateId: template.id, amount, reasonCode: 'WORK_REWARD', refType: 'work_shift', refId: shift.id })
            resourceToOwner = { code: template.code, amount }
          } else {
            await ResourcesService.add(tx, { characterId, resourceTemplateId: template.id, amount, reasonCode: 'WORK_REWARD', refType: 'work_shift', refId: shift.id })
            resourceReward = { code: template.code, amount }
          }
        }
      }
      await tx.characterProfession.update({ where: { id: profession.id }, data: { exp: professionExp, level: professionLevel } })
      const aggregate = await tx.characterProfession.aggregate({ where: { characterId }, _max: { level: true, exp: true } })
      await tx.character.update({ where: { id: characterId }, data: { status: 'ACTIVE', productionLevel: aggregate._max.level ?? professionLevel, productionExp: aggregate._max.exp ?? professionExp } })
      await tx.productionLog.create({ data: { characterId, productionObjectId: shift.productionObjectId, eventType: 'SHIFT_CLAIMED', metadataJson: { shiftId, salary, professionCode: shift.professionCode, professionExpGain, professionLevel, resourceReward, resourceToOwner, toolUse, cycleContribution } } })
      return { shiftId, salary, professionCode: shift.professionCode, professionExpGain, professionExp, professionLevel, resourceReward, resourceToOwner, toolUse, cycleContribution, newBalance }
    } })
  },

  async cancel(characterId: string, shiftId: string) {
    return withTransaction(async tx => {
      const shift = await tx.workShift.findFirst({ where: { id: shiftId, characterId, helperId: null, status: 'ACTIVE' } })
      if (!shift) throw new AppError(ErrorCode.WORK_SHIFT_NOT_FOUND, 'Active shift not found', 404)
      await tx.workShift.update({ where: { id: shift.id }, data: { status: 'CANCELLED' } })
      if (shift.toolInstanceId) await tx.itemInstance.updateMany({ where: { id: shift.toolInstanceId, ownerId: characterId, status: 'LOCKED' }, data: { status: 'NORMAL' } })
      await tx.character.updateMany({ where: { id: characterId, status: 'WORKING' }, data: { status: 'ACTIVE' } })
      await tx.productionLog.create({ data: { characterId, productionObjectId: shift.productionObjectId, eventType: 'SHIFT_CANCELLED', metadataJson: { shiftId, professionCode: shift.professionCode } } })
      return { cancelled: true }
    })
  },
}
