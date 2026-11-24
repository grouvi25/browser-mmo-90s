/**
 * Городская больница и ЧМЦ — документ Димы v8.
 *
 * Травмпункт (раздел I): лёгкая, средняя, тяжёлая; рубли и короткое
 * ожидание. ЧМЦ: средняя и тяжёлая за доллары, сразу.
 *
 * Реанимация (разделы 7–9): критическое и кома. Выйти нельзя, вылечиться
 * сразу тоже: платят только за сокращение отлёжки, и не ниже минимума от
 * начала состояния. Платит сам пациент (рубли), через ЧМЦ (доллары) или
 * бригада из общака — заявок столько, сколько позволяет авторитет, одна
 * в полчаса. «Пассажиру» помощь даётся в долг перед общаком; пока долг не
 * погашен, новые заявки отклоняются.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { withTransaction } from '../../shared/db/transaction'
import { BalanceConfig } from '../../config/balance.config'
import { EconomyService } from '../economy/economy.service'
import { DollarsService } from '../dollars/dollars.service'
import {
  activeInjury, AUTHORITY_TITLE, authorityLevel, blocksCombat, brigadeAidLimit, clinicOffer, hospitalOffer,
  INJURY_TITLE, injuryEffects, injuryNotice, injuryUpdate, inReanimation, reanimationFloor, reanimationOffer,
  rollFairInjury, shortenedUntil, type FightOutcome, type InjuryState,
} from './injuries.formulas'

const MINUTE = 60_000
const I = () => BalanceConfig.injuries

const injuryFields = {
  id: true, nickname: true, status: true, injuryTier: true, injuryUntil: true, injuryTreatedAt: true,
  injuryCriticalAt: true, injuryAidCount: true, injuryAidAt: true, injuryClinicUsed: true,
} as const

function conflict(message: string): never {
  throw new AppError(ErrorCode.CONFLICT, message, 409)
}

/** Реанимация: что может сам пациент. */
function reanimationView(state: InjuryState, now: Date) {
  const injury = activeInjury(state, now)
  if (!injury || !inReanimation(state, now)) return null
  const self = reanimationOffer(injury.tier, 'SELF')!
  const clinic = reanimationOffer(injury.tier, 'CLINIC')!
  const clinicLeft = (state.injuryClinicUsed ?? 0) < I().clinicMaxPerState
  return {
    floor: reanimationFloor(state),
    self: shortenedUntil(state, self.minutes, now) ? { rubles: self.rubles!, minutes: self.minutes } : null,
    clinic: clinicLeft && shortenedUntil(state, clinic.minutes, now) ? { dollars: clinic.dollars!, minutes: clinic.minutes } : null,
    aidUsed: state.injuryAidCount ?? 0,
  }
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
    reanimation: reanimationView(state, now),
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

/** Помощь бригады одному пациенту: можно ли сейчас и почему нет. */
function aidState(patient: InjuryState, authority: number, debt: number, now: Date) {
  const injury = activeInjury(patient, now)
  if (!injury || !inReanimation(patient, now)) return { offer: null, reason: 'Помощь не нужна' }
  const offer = reanimationOffer(injury.tier, 'BRIGADE')!
  const limit = brigadeAidLimit(authority, injury.tier)
  const used = patient.injuryAidCount ?? 0
  const next = patient.injuryAidAt ? new Date(patient.injuryAidAt.getTime() + I().aidCooldownMinutes * MINUTE) : null
  let reason: string | null = null
  if (used >= limit) reason = 'Лимит заявок по авторитету исчерпан'
  else if (debt > 0) reason = `Сначала верни старое: долг перед общаком ${debt.toLocaleString('ru-RU')} ₽`
  else if (next && next > now) reason = 'Следующая заявка через полчаса после прошлой'
  else if (!shortenedUntil(patient, offer.minutes, now)) reason = 'Сокращать дальше некуда'
  return { offer: { rubles: offer.rubles!, minutes: offer.minutes }, limit, used, next, reason }
}

export const HospitalService = {
  async status(userId: string, now = new Date()) {
    const character = await prisma.character.findUnique({ where: { userId }, select: injuryFields })
    if (!character) throw AppError.notFound('Character', userId)
    const tiers = ['LIGHT', 'MEDIUM', 'HEAVY'] as const
    const member = await prisma.clanMember.findUnique({
      where: { characterId: character.id }, select: { clanId: true, status: true, authority: true, treasuryDebt: true, clan: { select: { treasury: true } } },
    })
    let brigade = null
    if (member?.status === 'ACTIVE') {
      const roster = await prisma.clanMember.findMany({
        where: { clanId: member.clanId, status: 'ACTIVE', characterId: { not: character.id } },
        select: { characterId: true, authority: true, treasuryDebt: true },
      })
      const patients = await prisma.character.findMany({
        where: { id: { in: roster.map(r => r.characterId) }, injuryTier: { in: ['CRITICAL', 'COMA'] }, injuryUntil: { gt: now } },
        select: injuryFields, orderBy: { nickname: 'asc' },
      })
      const byId = new Map(roster.map(r => [r.characterId, r]))
      brigade = {
        treasury: member.clan.treasury,
        authority: member.authority,
        level: AUTHORITY_TITLE[authorityLevel(member.authority)],
        debt: member.treasuryDebt,
        patients: patients.map(p => {
          const m = byId.get(p.id)!
          const aid = aidState(p, m.authority, m.treasuryDebt, now)
          return {
            id: p.id, nickname: p.nickname, title: INJURY_TITLE[p.injuryTier!], until: p.injuryUntil,
            level: AUTHORITY_TITLE[authorityLevel(m.authority)], ...aid,
          }
        }),
      }
    }
    return {
      injury: injuryView(character, now),
      brigade,
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

  /** ЧМЦ: средняя и тяжёлая за доллары, готов сразу. */
  async clinic(userId: string, now = new Date()) {
    return withTransaction(async tx => {
      const character = await tx.character.findUnique({ where: { userId }, select: injuryFields })
      if (!character) throw AppError.notFound('Character', userId)
      if (character.status === 'IN_BATTLE') conflict('Лечиться можно после боя')
      const view = injuryView(character, now)
      if (!view) conflict('Лечить нечего: вы здоровы')
      if (view.reanimation) conflict('Из реанимации ЧМЦ только сокращает отлёжку')
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

  /** Реанимация: пациент сам платит за сокращение — рублями или через ЧМЦ долларами. */
  async shorten(userId: string, channel: 'SELF' | 'CLINIC', now = new Date()) {
    return withTransaction(async tx => {
      const character = await tx.character.findUnique({ where: { userId }, select: injuryFields })
      if (!character) throw AppError.notFound('Character', userId)
      const view = injuryView(character, now)
      const offer = channel === 'SELF' ? view?.reanimation?.self : view?.reanimation?.clinic
      if (!view?.reanimation) conflict('Вы не в реанимации')
      if (!offer) conflict(channel === 'CLINIC' ? 'ЧМЦ на это состояние уже помог или сокращать некуда' : 'Сокращать дальше некуда')
      const until = shortenedUntil(character, offer.minutes, now)!
      const claimed = await tx.character.updateMany({
        where: { id: character.id, injuryUntil: view.until, injuryClinicUsed: character.injuryClinicUsed },
        data: { injuryUntil: until, ...(channel === 'CLINIC' ? { injuryClinicUsed: { increment: 1 } } : {}) },
      })
      if (!claimed.count) conflict('Состояние изменилось. Обновите страницу')
      if (channel === 'CLINIC') {
        await DollarsService.debit(tx, { characterId: character.id, amount: (offer as { dollars: number }).dollars, reason: 'CLINIC', note: view.title })
      } else {
        await EconomyService.debit(tx, { characterId: character.id, amount: (offer as { rubles: number }).rubles, reasonCode: 'REANIMATION', note: view.title })
      }
      return { until }
    })
  },

  /** Боец бригады оплачивает из общака сокращение отлёжки товарищу. */
  async brigadeAid(userId: string, patientId: string, now = new Date()) {
    return withTransaction(async tx => {
      const doctor = await tx.character.findUnique({ where: { userId }, select: { id: true, nickname: true } })
      if (!doctor) throw AppError.notFound('Character', userId)
      if (doctor.id === patientId) conflict('Помощь из общака заявляет товарищ, а не сам пациент')
      const me = await tx.clanMember.findUnique({ where: { characterId: doctor.id }, include: { clan: true } })
      if (!me || me.status !== 'ACTIVE') throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Вы не состоите в бригаде', 404)
      if (me.clan.isFrozen) throw new AppError(ErrorCode.CLAN_FROZEN, 'Бригада заморожена за долги', 409)
      const them = await tx.clanMember.findUnique({ where: { characterId: patientId } })
      if (!them || them.status !== 'ACTIVE' || them.clanId !== me.clanId) throw AppError.notFound('Боец бригады', patientId)
      const patient = await tx.character.findUniqueOrThrow({ where: { id: patientId }, select: injuryFields })
      const aid = aidState(patient, them.authority, them.treasuryDebt, now)
      if (!aid.offer || aid.reason) conflict(aid.reason ?? 'Помощь не нужна')
      const until = shortenedUntil(patient, aid.offer.minutes, now)!
      const claimed = await tx.character.updateMany({
        where: { id: patientId, injuryUntil: patient.injuryUntil, injuryAidCount: patient.injuryAidCount },
        data: { injuryUntil: until, injuryAidCount: { increment: 1 }, injuryAidAt: now },
      })
      if (!claimed.count) conflict('Состояние изменилось. Обновите страницу')
      const paid = await tx.clan.updateMany({ where: { id: me.clanId, treasury: { gte: aid.offer.rubles } }, data: { treasury: { decrement: aid.offer.rubles } } })
      if (!paid.count) throw new AppError(ErrorCode.ECON_INSUFFICIENT_FUNDS, 'В общаке не хватает денег', 409)
      const clan = await tx.clan.findUniqueOrThrow({ where: { id: me.clanId }, select: { treasury: true } })
      await tx.clanTreasuryLog.create({
        data: { clanId: me.clanId, characterId: doctor.id, amount: -aid.offer.rubles, balanceAfter: clan.treasury, reason: `Реанимация: ${patient.nickname}` },
      })
      // «Пассажир» получает помощь в долг: вернуть взносом в общак.
      const passenger = authorityLevel(them.authority) === 'PASSENGER'
      if (passenger) await tx.clanMember.update({ where: { id: them.id }, data: { treasuryDebt: { increment: aid.offer.rubles } } })
      await tx.gameNotice.create({
        data: {
          characterId: patientId,
          text: `🤝 ${doctor.nickname} оплатил(а) из общака сокращение отлёжки на ${aid.offer.minutes / 60} ч.`
            + (passenger ? ` Это долг перед общаком: ${aid.offer.rubles.toLocaleString('ru-RU')} ₽, гасится взносом.` : ''),
        },
      })
      return { until }
    })
  },
}

