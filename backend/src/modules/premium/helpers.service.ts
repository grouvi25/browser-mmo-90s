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
import type { HelperTactic, Prisma } from '@prisma/client'
import { expToNextLevel, helperHpMax } from '../battles/combat-helper'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { BalanceConfig } from '../../config/balance.config'
import { DollarsService } from '../dollars/dollars.service'
import { EconomyService } from '../economy/economy.service'
import { CycleService } from '../production/cycle.service'
import { ResourcesService } from '../resources/resources.service'
import { awaitsOwner, calcFinalSalary, calcProductionExp, realShiftMinutes, workerEfficiency } from '../work/work.formulas'
import { soldGeneralTools, toolForTier } from '../work/tool-names'
import { professionLevelFromExp, PROFESSION_CODES, PROFESSION_NAMES, type ProfessionCode } from '../professions/professions'
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

function knownProfession(code: string): boolean {
  return (PROFESSION_CODES as readonly string[]).includes(code)
}

/** Премиальный инструмент держит только сам игрок (заказчик 30.10). */
const PREMIUM_TOOL_TIER = 5
const professionName = (code: string) => PROFESSION_NAMES[code as ProfessionCode] ?? code

/**
 * Помощник работает инструментом хозяина и тратит одно использование сразу.
 * Вещь не запирается на смену, иначе единственный набор держал бы самого
 * хозяина без работы, пока на смене его помощник.
 */
async function spendOwnerTool(
  tx: Prisma.TransactionClient,
  params: { characterId: string; shiftKey: string; toolCode: string | null; tier: number },
) {
  const candidates = await tx.itemInstance.findMany({
    where: {
      ownerId: params.characterId, status: 'NORMAL', usesLeft: { gt: 0 },
      template: params.toolCode ? { type: 'TOOL', code: params.toolCode } : { type: 'TOOL', toolTier: { gte: params.tier } },
    },
    include: { template: { select: { toolTier: true } } },
    orderBy: { createdAt: 'asc' },
  })
  candidates.sort((a, b) => (a.template.toolTier ?? 0) - (b.template.toolTier ?? 0))
  for (const candidate of candidates) {
    const spent = await tx.itemInstance.updateMany({
      where: { id: candidate.id, status: 'NORMAL', usesLeft: { gt: 0 } },
      data: { usesLeft: { decrement: 1 } },
    })
    if (spent.count !== 1) continue
    const usesLeft = (candidate.usesLeft ?? 1) - 1
    if (usesLeft <= 0) await tx.itemInstance.update({ where: { id: candidate.id }, data: { status: 'CONSUMED' } })
    await tx.itemLog.create({ data: { itemId: candidate.id, characterId: params.characterId, actionCode: 'TOOL_USE', details: { helperShift: params.shiftKey, usesLeft } } })
    return
  }
  const name = params.toolCode
    ? (await tx.itemTemplate.findUnique({ where: { code: params.toolCode }, select: { name: true } }))?.name ?? params.toolCode
    : toolForTier(await soldGeneralTools(tx), params.tier)
  throw new AppError(ErrorCode.WORK_TOOL_REQUIRED, name ? `Нужен инструмент: ${name}` : `Нужен инструмент ${params.tier} уровня`, 400)
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
  /** Тактика боевого помощника; в идущем бою меняется отдельно (BattleService). */
  async setTactic(characterId: string, helperId: string, tactic: HelperTactic) {
    const helper = await prisma.helper.findFirst({ where: { id: helperId, characterId } })
    if (!helper) throw new AppError(ErrorCode.NOT_FOUND, 'Помощник не найден', 404)
    if (helper.kind !== 'COMBAT') throw new AppError(ErrorCode.VALIDATION_ERROR, 'Тактика есть только у боевого помощника', 422)
    await prisma.helper.update({ where: { id: helperId }, data: { tactic } })
    return { id: helperId, tactic }
  },

  async list(characterId: string) {
    const [helpers, state, entry] = await Promise.all([
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
      // Новый помощник начинает с нуля: нанять можно того, для кого есть
      // работа без уровня, иначе он никогда не выйдет на первую смену.
      prisma.productionObject.findMany({
        where: { isActive: true, status: 'ACTIVE', requiredProfessionLevel: 0 },
        select: { requiredProfessionCode: true },
        distinct: ['requiredProfessionCode'],
      }),
    ])
    return {
      items: helpers.map(helper => ({
        id: helper.id,
        name: helper.name,
        kind: helper.kind,
        // Без подписки помощник числится DORMANT, что бы ни лежало в базе:
        // подписка могла истечь по времени, а строку никто не трогал.
        status: state.isPremium ? helper.status : 'DORMANT',
        professionCode: helper.professionCode,
        professionName: professionName(helper.professionCode),
        professionLevel: helper.professionLevel,
        professionExp: helper.professionExp,
        skillCap: H.skillCap,
        activeShift: helper.activeShift,
        // Боевой помощник: уровень, опыт до следующего, здоровье, тактика.
        tactic: helper.tactic,
        combatLevel: helper.combatLevel,
        combatExp: helper.combatExp,
        combatHpMax: helperHpMax(helper.combatLevel),
        combatExpToNext: expToNextLevel(helper.combatLevel),
      })),
      slots: { used: helpers.length, total: state.benefits.helperSlots },
      prices: { COMBAT: H.priceCombatUsd, WORK: H.priceWorkUsd },
      professions: entry
        .map(row => row.requiredProfessionCode)
        .filter(knownProfession)
        .map(code => ({ code, name: professionName(code) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    }
  },

  /**
   * Объекты, на которые помощника вообще пустят: свои, бригадные и
   * государственные, которые сейчас работают.
   *
   * Считает сервер, а не клиент: иначе экран предлагал бы объекты, а мутация
   * отказывала бы — ровно та ошибка, которую этап уже ловил на налётах.
   */
  async eligibleObjects(characterId: string) {
    const member = await prisma.clanMember.findUnique({
      where: { characterId },
      select: { clanId: true, status: true },
    })
    const clanId = member && member.status === 'ACTIVE' ? member.clanId : null
    const objects = await prisma.productionObject.findMany({
      where: {
        isActive: true,
        status: 'ACTIVE',
        requiredProfessionLevel: { lte: H.skillCap },
        OR: [
          { ownerType: 'PRIVATE', ownerCharacterId: characterId },
          ...(clanId ? [{ ownerType: 'CLAN' as const, ownerClanId: clanId }] : []),
          { ownerType: 'SYSTEM', baseSalary: { gt: 0 } },
          { ownerType: 'SYSTEM', producesResourceCode: { not: null } },
        ],
      },
      select: {
        id: true, name: true, requiredProfessionCode: true, requiredProfessionLevel: true,
        ownerType: true, workerSlots: true, baseSalary: true, salaryOverride: true, activeRecipeId: true,
        equipment: { select: { isActive: true, requiredToolTier: true } },
      },
      orderBy: { name: 'asc' },
    })
    const recipeIds = objects.map(object => object.activeRecipeId).filter((id): id is string => !!id)
    const [recipes, soldTools] = await Promise.all([
      prisma.productionRecipe.findMany({ where: { id: { in: recipeIds } }, select: { id: true, requiredToolCode: true, requiredToolTier: true } }),
      soldGeneralTools(prisma),
    ])
    const recipeOf = new Map(recipes.map(recipe => [recipe.id, recipe]))
    const toolNames = new Map((await prisma.itemTemplate.findMany({
      where: { code: { in: recipes.map(recipe => recipe.requiredToolCode).filter((code): code is string => !!code) } },
      select: { code: true, name: true },
    })).map(row => [row.code, row.name]))
    const items = objects
      .filter(object => (recipeOf.get(object.activeRecipeId ?? '')?.requiredToolTier ?? 0) < PREMIUM_TOOL_TIER)
      .map(({ activeRecipeId, equipment, baseSalary, salaryOverride, ...object }) => {
        const toolCode = recipeOf.get(activeRecipeId ?? '')?.requiredToolCode ?? null
        const tier = object.ownerType === 'SYSTEM' && equipment?.isActive ? equipment.requiredToolTier : null
        return {
          ...object,
          salary: salaryOverride ?? baseSalary,
          requiredToolName: toolCode ? toolNames.get(toolCode) ?? toolCode : tier ? toolForTier(soldTools, tier) : null,
        }
      })
    return { items }
  },

  /**
   * Нанять помощника. Правка заказчика 21.10: всего двое — боевой и
   * рабочий или два рабочих; двух боевых нельзя. Уволенный помощник
   * удаляется вместе с прогрессом: новый начинает с нуля.
   */
  async hire(characterId: string, name: string, professionCode: string, kind: 'WORK' | 'COMBAT' = 'WORK') {
    return withTransaction(async tx => {
      const state = await assertSubscribed(characterId)
      if (kind === 'WORK' && !knownProfession(professionCode)) {
        throw new AppError(ErrorCode.HELP_PROFESSION_UNKNOWN, 'Неизвестная профессия', 400)
      }
      if (kind === 'COMBAT' && await tx.helper.count({ where: { characterId, kind: 'COMBAT' } }) > 0) {
        throw new AppError(ErrorCode.HELP_SLOTS_FULL, 'Боевой помощник может быть только один: второй — только рабочий', 409)
      }
      const used = await tx.helper.count({ where: { characterId } })
      if (used >= state.benefits.helperSlots) {
        throw new AppError(
          ErrorCode.HELP_SLOTS_FULL,
          `Все слоты заняты: ${state.benefits.helperSlots}`,
          409,
        )
      }
      // Заказчик 30.10: «Помощник боевой 200$, крафтовый 100$».
      await DollarsService.debit(tx, { characterId, amount: kind === 'COMBAT' ? H.priceCombatUsd : H.priceWorkUsd, reason: 'PURCHASE', note: `Помощник «${name.trim()}»` })
      const helper = await tx.helper.create({
        data: { characterId, name: name.trim(), kind, professionCode: kind === 'COMBAT' ? 'combat' : professionCode },
      })
      return { id: helper.id, name: helper.name, kind: helper.kind, professionCode: helper.professionCode }
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
      if (helper.kind === 'COMBAT') throw new AppError(ErrorCode.HELP_PROFESSION_UNKNOWN, 'Боевой помощник на смены не ходит', 409)
      if (helper.activeShiftId) {
        throw new AppError(ErrorCode.HELP_ALREADY_WORKING, 'Помощник уже на смене', 409)
      }

      const object = await tx.productionObject.findUnique({
        where: { id: productionObjectId },
        include: { equipment: true },
      })
      if (!object) throw new AppError(ErrorCode.WORK_OBJECT_NOT_FOUND, 'Production object not found', 404)
      // Премиальный инструмент держит сам игрок (заказчик 30.10).
      const recipe = object.activeRecipeId
        ? await tx.productionRecipe.findUnique({ where: { id: object.activeRecipeId }, select: { requiredToolCode: true, requiredToolTier: true } })
        : null
      if (recipe?.requiredToolCode && recipe.requiredToolTier >= PREMIUM_TOOL_TIER) {
        throw new AppError(ErrorCode.WORK_TOOL_REQUIRED, 'Этот рецепт выполняет только сам игрок со своим инструментом', 400)
      }

      // Свой объект, объект своей бригады или государственный.
      //
      // Заказчик 05.11 (обращение №24) отменил своё решение В10 от 03.09:
      // помощник устраивается и на госработу. Зарплату там платит казна, так
      // что доход подписчика с двумя помощниками выше коридора 130%, цифра
      // считается отдельной строкой в scripts/simulate-full.ts. Чужие частные
      // объекты остаются закрыты: они платят из чужой кассы.
      const state = object.ownerType === 'SYSTEM'
      if (awaitsOwner(object)) {
        throw new AppError(ErrorCode.WORK_OBJECT_UNAVAILABLE, 'Цех продаётся: смены начнутся, когда его купят', 409)
      }
      const mine = object.ownerType === 'PRIVATE' && object.ownerCharacterId === characterId
      const clanMember = object.ownerType === 'CLAN' && object.ownerClanId
        ? await tx.clanMember.findFirst({
          where: { characterId, clanId: object.ownerClanId, status: 'ACTIVE' },
          select: { id: true },
        })
        : null
      if (!state && !mine && !clanMember) {
        throw new AppError(
          ErrorCode.HELP_FOREIGN_OBJECT,
          'На чужой частный объект помощника не возьмут',
          409,
        )
      }
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

      // На госработу правила те же, что у игрока: со своим инструментом. Рецепт
      // под именной инструмент требует его на любом объекте.
      const toolCode = recipe?.requiredToolCode ?? null
      const tier = state && object.equipment?.isActive ? object.equipment.requiredToolTier : null
      if (toolCode || tier) {
        await spendOwnerTool(tx, { characterId, shiftKey: helperId, toolCode, tier: tier ?? 1 })
      }

      const now = new Date()
      const endsAt = new Date(now.getTime() + realShiftMinutes(object.shiftDurationMinutes) * 60_000)
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
      // Смена без оклада платит сырьём: начислять нечего, как и у игрока.
      const salary = full > 0 ? Math.max(1, Math.round(full * H.efficiency)) : 0

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
      const newBalance = salary > 0 ? await EconomyService.credit(tx, {
        characterId, amount: salary,
        reasonCode: privatelyOwned ? 'SALARY_FROM_OBJECT' : 'WORK_SALARY',
        refType: 'work_shift', refId: shift.id,
      }) : (await tx.character.findUniqueOrThrow({ where: { id: characterId }, select: { money: true } })).money

      const cycleContribution = shift.productionObject.activeRecipeId
        ? await CycleService.contributeLabor(tx, {
          objectId: shift.productionObjectId,
          characterId,
          workShiftId: shift.id,
          shiftDurationMinutes: shift.productionObject.shiftDurationMinutes,
          professionLevel: helper.professionLevel,
          workerEfficiency: helperEfficiency(helper.professionLevel),
          toolTier: 0,
        })
        : null

      // Сырьё объекта — хозяину, как после своей смены (правка заказчика
      // 22.10: «помощники когда работают, ресурсы не добавляются»). Выход
      // помощника слабее, как и зарплата, но не меньше единицы.
      let resourceReward: { code: string; amount: number } | null = null
      const object = shift.productionObject
      if (object.producesResourceCode && object.outputAmountMax > 0) {
        const template = await tx.resourceTemplate.findUnique({ where: { code: object.producesResourceCode } })
        if (template) {
          const rolled = Math.floor(Math.random() * (object.outputAmountMax - object.outputAmountMin + 1)) + object.outputAmountMin
          const amount = Math.max(1, Math.round(rolled * H.efficiency))
          await ResourcesService.add(tx, { characterId, resourceTemplateId: template.id, amount, reasonCode: 'WORK_REWARD', refType: 'work_shift', refId: shift.id })
          resourceReward = { code: template.code, amount }
        }
      }

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
        cycleContribution, resourceReward,
      }
    })
  },
}
