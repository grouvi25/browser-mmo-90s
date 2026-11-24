/**
 * Городская больница (травмпункт) и ЧМЦ — лечение травм после честных боёв,
 * документ Димы v8, раздел I. Травмпункт берёт рубли и после оплаты
 * держит игрока ещё несколько минут; ЧМЦ берёт доллары и отпускает сразу.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { withTransaction } from '../../shared/db/transaction'
import { EconomyService } from '../economy/economy.service'
import { DollarsService } from '../dollars/dollars.service'
import {
  activeInjury, blocksCombat, clinicOffer, hospitalOffer, INJURY_TITLE, injuryEffects, injuryNotice,
  injuryUpdate, rollFairInjury, type FightOutcome, type InjuryState,
} from './injuries.formulas'

const MINUTE = 60_000

const injuryFields = {
  id: true, status: true, injuryTier: true, injuryUntil: true, injuryTreatedAt: true,
} as const

function conflict(message: string): never {
  throw new AppError(ErrorCode.CONFLICT, message, 409)
}

/** Что показать игроку о его травме. */
export function injuryView(state: InjuryState, now = new Date()) {
  const injury = activeInjury(state, now)
  if (!injury) return null
  const effects = injuryEffects(state, now)
  const hospital = injury.treated ? null : hospitalOffer(injury.tier)
  const clinic = clinicOffer(injury.tier)
  return {
    tier: injury.tier,
    title: INJURY_TITLE[injury.tier],
    until: injury.until,
    treated: injury.treated,
    blocksCombat: blocksCombat(state, now),
    penaltyPercent: Math.round((1 - effects.damage) * 100),
    expMultiplier: effects.exp,
    // Платить в травмпункте есть смысл, только если ожидание короче отлёжки.
    hospital: hospital && injury.until.getTime() - now.getTime() > hospital.waitMinutes * MINUTE ? hospital : null,
    clinic,
  }
}

/**
 * Травмы по итогам боя на Стрелках. Вызывается внутри транзакции завершения
 * боя, по одному разу на каждого игрока с исходом. Ничьи сюда не доходят.
 */
export async function recordFairInjury(tx: Prisma.TransactionClient, characterId: string, fight: FightOutcome, now = new Date()) {
  const tier = rollFairInjury(fight)
  if (!tier) return null
  const character = await tx.character.findUniqueOrThrow({ where: { id: characterId }, select: injuryFields })
  const data = injuryUpdate(character, tier, now)
  if (!data) return null
  await tx.character.update({ where: { id: characterId }, data })
  await tx.gameNotice.create({ data: { characterId, text: injuryNotice(tier) } })
  return tier
}

export const HospitalService = {
  async status(userId: string, now = new Date()) {
    const character = await prisma.character.findUnique({ where: { userId }, select: injuryFields })
    if (!character) throw AppError.notFound('Character', userId)
    const tiers = ['LIGHT', 'MEDIUM', 'HEAVY'] as const
    return {
      injury: injuryView(character, now),
      // Вывеска травмпункта и прайс ЧМЦ — из того же конфига, что и списание.
      prices: {
        hospital: tiers.map(tier => ({ tier, title: INJURY_TITLE[tier], ...hospitalOffer(tier)! })),
        clinic: tiers.flatMap(tier => {
          const offer = clinicOffer(tier)
          return offer ? [{ tier, title: INJURY_TITLE[tier], ...offer }] : []
        }),
      },
    }
  },

  /** Травмпункт: оплата в рублях, дальше короткое ожидание. */
  async treat(userId: string, now = new Date()) {
    return withTransaction(async tx => {
      const character = await tx.character.findUnique({ where: { userId }, select: injuryFields })
      if (!character) throw AppError.notFound('Character', userId)
      if (character.status === 'IN_BATTLE') conflict('Лечиться можно после боя')
      const view = injuryView(character, now)
      if (!view) conflict('Лечить нечего: вы здоровы')
      if (!view.hospital) conflict(view.treated ? 'Лечение уже оплачено, ждите' : 'Травмпункт сейчас не поможет быстрее')
      const until = new Date(now.getTime() + view.hospital.waitMinutes * MINUTE)
      const claimed = await tx.character.updateMany({
        where: { id: character.id, injuryUntil: view.until, injuryTreatedAt: null, status: { not: 'IN_BATTLE' } },
        data: { injuryUntil: until, injuryTreatedAt: now },
      })
      if (!claimed.count) conflict('Состояние изменилось. Обновите страницу')
      await EconomyService.debit(tx, {
        characterId: character.id, amount: view.hospital.rubles, reasonCode: 'HOSPITAL', note: view.title,
      })
      return { until }
    })
  },

  /** ЧМЦ: оплата в долларах, готов сразу. */
  async clinic(userId: string, now = new Date()) {
    return withTransaction(async tx => {
      const character = await tx.character.findUnique({ where: { userId }, select: injuryFields })
      if (!character) throw AppError.notFound('Character', userId)
      if (character.status === 'IN_BATTLE') conflict('Лечиться можно после боя')
      const view = injuryView(character, now)
      if (!view) conflict('Лечить нечего: вы здоровы')
      if (!view.clinic) conflict('ЧМЦ такие травмы не принимает: идите в травмпункт')
      const claimed = await tx.character.updateMany({
        where: { id: character.id, injuryUntil: view.until, status: { not: 'IN_BATTLE' } },
        data: { injuryTier: null, injuryUntil: null, injuryTreatedAt: null },
      })
      if (!claimed.count) conflict('Состояние изменилось. Обновите страницу')
      await DollarsService.debit(tx, { characterId: character.id, amount: view.clinic.dollars, reason: 'CLINIC', note: view.title })
      return { healed: true }
    })
  },
}
