// =============================================================
// ПОМОЩНИКИ — шаг F6 Этапа 4
//
// Какую проблему решают: производственный цикл требует труда, труд
// набирается сменами, смена идёт час реального времени. Человек, который
// не может сидеть в игре весь день, объективно проигрывает тому, кто
// может. Помощник выравнивает это за деньги — и это единственная честная
// вещь, которую подписка может продавать в игре с реальным временем.
//
// Эффективность 0.6 выведена, а не назначена: ориентир Этапа 3 — доход
// владельца объекта за час 120–160% от смены наёмного рабочего. Два
// помощника по 0.6 дают ровно 120%, нижнюю границу коридора. Подписчик
// с двумя помощниками зарабатывает как один добросовестный владелец
// объекта, а не как три игрока, и наёмный труд живых людей остаётся
// выгоднее.
//
// ТЗ: docs/specs/stage-4/MASTER_TZ_STAGE_4_STRATEGY_PREMIUM_WAR.md, раздел 19.
// =============================================================
import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { BalanceConfig } from '../../config/balance.config'
import { EconomyService } from '../economy/economy.service'
import { CycleService } from '../production/cycle.service'
import { calcFinalSalary, calcProductionExp, workerEfficiency } from '../work/work.formulas'
import { professionLevelFromExp, PROFESSION_CHAINS } from '../professions/professions'
import { PremiumService } from './premium.service'

const H = BalanceConfig.strategy.helper

/** Уровень помощника по опыту, с его собственным потолком. */
export function helperLevelFromExp(exp: number): number {
  return Math.min(H.skillCap, professionLevelFromExp(exp))
}

/**
 * Эффективность смены помощника.
 *
 * Берётся та же кривая, что у игрока, и умножается на 0.6. Не своя
 * формула: иначе профессия помощника со временем разошлась бы с
 * профессией игрока, и балансировать пришлось бы две вещи вместо одной.
 */
export function helperEfficiency(professionLevel: number): number {
  return workerEfficiency(Math.min(professionLevel, H.skillCap)) * H.efficiency
}

/**
 * Профессия из реестра переделов. PROFESSION_CHAINS — это ветки
 * (metal / construction / chemistry), а не сами профессии: ключи брать
 * нельзя, нужны значения.
 */
function knownProfession(code: string): boolean {
  return Object.values(PROFESSION_CHAINS).some(chain => (chain as readonly string[]).includes(code))
}

async function assertSubscribed(characterId: string) {
  const state = await PremiumService.state(characterId)
  if (!state.isPremium) {
    throw new AppError(ErrorCode.HELP_NO_SUBSCRIPTION, 'Нужна активная подписка', 409)
  }
  return state
}

export const HelpersService = {
  /** Список помощников и занятые слоты. */
  async list(characterId: string) {
    const [helpers, state] = await Promise.all([
      prisma.helper.findMany({
        where: { characterId },
        orderBy: { createdAt: 'asc' },
        include: {
          activeShift: {
            select: { id: true, productionObjectId: true, endsAt: true, status: true },
          },
        },
      }),
      PremiumService.state(characterId),
    ])
    return {
      items: helpers.map(helper => ({
        id: helper.id,
        name: helper.name,
        // Без подписки помощник числится DORMANT, что бы ни лежало в базе:
        // подписка могла истечь по времени, а строку никто не трогал.
        status: state.isPremium ? helper.status : 'DORMANT',
        professionCode: helper.professionCode,
        professionLevel: helper.professionLevel,
        professionExp: helper.professionExp,
        skillCap: H.skillCap,
        activeShift: helper.activeShift,
      })),
      slots: { used: helpers.length, total: state.benefits.helperSlots },
    }
  },

  /** Нанять помощника. */
  async hire(characterId: string, name: string, professionCode: string) {
    return withTransaction(async tx => {
      const state = await assertSubscribed(characterId)
      if (!knownProfession(professionCode)) {
        throw new AppError(ErrorCode.HELP_PROFESSION_UNKNOWN, 'Неизвестная профессия', 400)
      }
      const used = await tx.helper.count({ where: { characterId } })
      if (used >= state.benefits.helperSlots) {
        throw new AppError(
          ErrorCode.HELP_SLOTS_FULL,
          `Все слоты заняты: ${state.benefits.helperSlots}`,
          409,
        )
      }
      const helper = await tx.helper.create({
        data: { characterId, name: name.trim(), professionCode },
      })
      return { id: helper.id, name: helper.name, professionCode: helper.professionCode }
    })
  },

  /** Уволить. Занятого не уволить: смена должна закрыться честно. */
  async dismiss(characterId: string, helperId: string) {
    return withTransaction(async tx => {
      const helper = await tx.helper.findUnique({ where: { id: helperId } })
      if (!helper || helper.characterId !== characterId) {
        throw AppError.notFound('Helper', helperId)
      }
      if (helper.activeShiftId) {
        throw new AppError(ErrorCode.HELP_ALREADY_WORKING, 'Помощник на смене', 409)
      }
      await tx.helper.delete({ where: { id: helperId } })
      return { dismissed: helperId }
    })
  },

  /**
   * Отправить помощника на смену.
   *
   * Создаётся ОБЫЧНАЯ WorkShift с проставленным helperId: слоты объекта,
   * журнал и вклад труда в цикл работают ровно так же, как у игрока.
   * Отличается источник профессии (своя, не хозяйская) и множитель.
   */
  async startShift(characterId: string, helperId: string, productionObjectId: string) {
    return withTransaction(async tx => {
      await assertSubscribed(characterId)
      const helper = await tx.helper.findUnique({ where: { id: helperId } })
      if (!helper || helper.characterId !== characterId) throw AppError.notFound('Helper', helperId)
      if (helper.activeShiftId) {
        throw new AppError(ErrorCode.HELP_ALREADY_WORKING, 'Помощник уже на смене', 409)
      }

      const object = await tx.productionObject.findUnique({
        where: { id: productionObjectId },
        include: { equipment: true },
      })
      if (!object) throw new AppError(ErrorCode.WORK_OBJECT_NOT_FOUND, 'Production object not found', 404)
      if (!object.isActive || object.status !== 'ACTIVE') {
        throw new AppError(ErrorCode.WORK_OBJECT_UNAVAILABLE, 'Production object unavailable', 409)
      }
      if (object.requiredProfessionCode !== helper.professionCode) {
        throw new AppError(
          ErrorCode.HELP_PROFESSION_TOO_LOW,
          `Объекту нужна профессия «${object.requiredProfessionCode}»`,
          409,
        )
      }
      // Потолок 3 при потолке игрока 6 — вторая страховка того же: верхние
      // переделы помощнику недоступны, специалиста он не заменит никогда.
      if (object.requiredProfessionLevel > H.skillCap) {
        throw new AppError(
          ErrorCode.HELP_PROFESSION_TOO_LOW,
          `Помощнику недоступны переделы выше ${H.skillCap} уровня`,
          409,
        )
      }
      if (helper.professionLevel < object.requiredProfessionLevel) {
        throw new AppError(
          ErrorCode.HELP_PROFESSION_TOO_LOW,
          'Профессия помощника ниже требуемой объектом',
          409,
        )
      }

      // Суточный потолок смен. У игрока он есть с Этапа 2, у помощника его
      // не было вовсе: смена длится полчаса, и подписчик мог гонять двух
      // помощников круглые сутки — сорок восемь смен на каждого. Приёмка
      // Этапа 4 намерила на этом 213% дохода активного игрока при коридоре
      // 130%. Число — из STAGE4_BALANCE 6.3, где модель считала шесть смен.
      const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0)
      const today = await tx.workShift.count({
        where: { helperId, startedAt: { gte: dayStart } },
      })
      if (today >= H.dailyShiftCap) {
        throw new AppError(
          ErrorCode.HELP_DAILY_LIMIT,
          `Помощник отработал суточную норму: ${H.dailyShiftCap} смен`,
          409,
        )
      }

      // Помощник занимает обычный рабочий слот: он такой же работник на
      // объекте, и владелец не должен получать бесконечную рабочую силу.
      const slots = await tx.workShift.count({ where: { productionObjectId, status: 'ACTIVE' } })
      if (slots >= object.workerSlots) {
        throw new AppError(ErrorCode.WORK_NO_SLOTS, 'No free worker slots', 409)
      }

      const now = new Date()
      const endsAt = new Date(now.getTime() + object.shiftDurationMinutes * 60_000)
      const shift = await tx.workShift.create({
        data: {
          characterId, productionObjectId, helperId,
          professionCode: object.requiredProfessionCode,
          status: 'ACTIVE', startedAt: now, endsAt,
          baseSalary: object.salaryOverride ?? object.baseSalary,
        },
      })
      await tx.helper.update({ where: { id: helperId }, data: { activeShiftId: shift.id } })
      await tx.productionLog.create({
        data: {
          characterId, productionObjectId, eventType: 'SHIFT_STARTED',
          metadataJson: { shiftId: shift.id, helperId, endsAt, professionCode: shift.professionCode },
        },
      })
      return { shiftId: shift.id, endsAt, baseSalary: shift.baseSalary }
    })
  },

  /**
   * Забрать смену помощника.
   *
   * Отдельно от WorkService.claim не по прихоти: опыт профессии идёт
   * ПОМОЩНИКУ, а не в CharacterProfession хозяина, и множитель другой.
   * Формулы при этом те же самые — деньги и опыт считаются одним кодом,
   * иначе балансировать пришлось бы две экономики вместо одной.
   */
  async claimShift(characterId: string, helperId: string) {
    return withTransaction(async tx => {
      const helper = await tx.helper.findUnique({ where: { id: helperId } })
      if (!helper || helper.characterId !== characterId) throw AppError.notFound('Helper', helperId)
      if (!helper.activeShiftId) throw new AppError(ErrorCode.WORK_SHIFT_NOT_FOUND, 'Смены нет', 404)

      let shift = await tx.workShift.findUniqueOrThrow({
        where: { id: helper.activeShiftId },
        include: { productionObject: true },
      })
      if (shift.status === 'ACTIVE' && shift.endsAt <= new Date()) {
        shift = await tx.workShift.update({
          where: { id: shift.id }, data: { status: 'READY_TO_CLAIM' },
          include: { productionObject: true },
        })
      }
      if (shift.status !== 'READY_TO_CLAIM') {
        throw new AppError(ErrorCode.WORK_NOT_READY, 'Смена ещё не закончилась', 400)
      }

      // Зарплата по той же формуле, но с эффективностью помощника.
      // Номер смены в сутках берётся по помощнику: усталость у него своя,
      // иначе смены помощника душили бы зарплату хозяина и наоборот.
      const dayStart = new Date(shift.startedAt); dayStart.setUTCHours(0, 0, 0, 0)
      const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000)
      const dailyNumber = await tx.workShift.count({
        where: { helperId, startedAt: { gte: dayStart, lt: dayEnd }, createdAt: { lte: shift.createdAt } },
      })
      const full = calcFinalSalary(
        shift.baseSalary, shift.productionObject.level, helper.professionLevel, Math.random(), dailyNumber,
      )
      const salary = Math.max(1, Math.round(full * H.efficiency))

      const expGain = calcProductionExp(shift.productionObject.baseProductionExp, shift.productionObject.level)
      // Навык помощника растёт вдвое медленнее игрока и упирается в свой потолок.
      const helperExp = helper.professionExp + expGain * H.skillRate
      const helperLevel = helperLevelFromExp(helperExp)

      const changed = await tx.workShift.updateMany({
        where: { id: shift.id, status: 'READY_TO_CLAIM' },
        data: { status: 'CLAIMED', claimedAt: new Date(), finalSalary: salary, professionExpReward: expGain },
      })
      if (changed.count !== 1) throw new AppError(ErrorCode.WORK_ALREADY_CLAIMED, 'Смена уже закрыта', 409)

      // Зарплату платит объект, если он частный — ровно как за живого
      // рабочего: помощник не бесплатная рабочая сила для чужого объекта.
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
      const newBalance = await EconomyService.credit(tx, {
        characterId, amount: salary,
        reasonCode: privatelyOwned ? 'SALARY_FROM_OBJECT' : 'WORK_SALARY',
        refType: 'work_shift', refId: shift.id,
      })

      const cycleContribution = shift.productionObject.activeRecipeId
        ? await CycleService.contributeLabor(tx, {
          objectId: shift.productionObjectId,
          characterId,
          workShiftId: shift.id,
          shiftDurationMinutes: Math.round((shift.endsAt.getTime() - shift.startedAt.getTime()) / 60_000),
          professionLevel: helper.professionLevel,
          workerEfficiency: helperEfficiency(helper.professionLevel),
          toolTier: 0,
        })
        : null

      await tx.helper.update({
        where: { id: helperId },
        data: { activeShiftId: null, professionExp: helperExp, professionLevel: helperLevel },
      })
      await tx.productionLog.create({
        data: {
          characterId, productionObjectId: shift.productionObjectId, eventType: 'SHIFT_CLAIMED',
          metadataJson: { shiftId: shift.id, helperId, salary, expGain },
        },
      })

      return {
        shiftId: shift.id, salary, newBalance,
        helper: { professionExp: helperExp, professionLevel: helperLevel },
        cycleContribution,
      }
    })
  },
}
