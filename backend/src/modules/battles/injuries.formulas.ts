/**
 * Травмы после честных боёв — документ Димы «Механика травм, лечения и
 * помощи» v8 (24.11), раздел I. Только Стрелки: дуэль и групповая заявка.
 *
 * Дима 25.11 заменил таблицы по доле HP фиксированными шансами: победитель
 * травм не получает, проигравший — лёгкую 20%, среднюю 10%, тяжёлую 5%,
 * реанимацию (критическое) 2%, в остальных случаях уходит целым.
 *
 * Все числа в BalanceConfig.injuries: Дима правит их из админки.
 */
import type { InjuryTier, Prisma } from '@prisma/client'
import { BalanceConfig } from '../../config/balance.config'

const MINUTE = 60_000
const I = () => BalanceConfig.injuries

/** Что может выпасть в честном бою. Кома — только от засад. */
export type FairInjuryTier = Extract<InjuryTier, 'LIGHT' | 'MEDIUM' | 'HEAVY' | 'CRITICAL'>

const SEVERITY: Record<InjuryTier, number> = { LIGHT: 1, MEDIUM: 2, HEAVY: 3, CRITICAL: 4, COMA: 5 }

export const INJURY_TITLE: Record<InjuryTier, string> = {
  LIGHT: 'Лёгкая травма',
  MEDIUM: 'Средняя травма',
  HEAVY: 'Тяжёлая травма',
  CRITICAL: 'Критическое состояние',
  COMA: 'Кома',
}

export interface InjuryState {
  injuryTier?: InjuryTier | null
  injuryUntil?: Date | null
  injuryTreatedAt?: Date | null
  injuryCriticalAt?: Date | null
  injuryAidCount?: number
  injuryAidAt?: Date | null
  injuryClinicUsed?: number
}

export function injuryMinutes(tier: InjuryTier): number {
  const c = I()
  if (tier === 'LIGHT') return c.lightMinutes
  if (tier === 'MEDIUM') return c.mediumMinutes
  if (tier === 'HEAVY') return c.heavyMinutes
  if (tier === 'CRITICAL') return c.criticalMinutes
  return c.comaMinutes
}

export function activeInjury(state: InjuryState, now = new Date()) {
  const { injuryTier: tier, injuryUntil: until } = state
  return tier && until && until > now ? { tier, until, treated: !!state.injuryTreatedAt } : null
}

/** Тяжёлая и выше: в бой нельзя, и напасть на него нельзя. */
export function blocksCombat(state: InjuryState, now = new Date()): boolean {
  const injury = activeInjury(state, now)
  return !!injury && SEVERITY[injury.tier] >= SEVERITY.HEAVY
}

/** Условие для выборок «кого можно поставить в бой». */
export function combatReady(now = new Date()): Prisma.CharacterWhereInput {
  return {
    OR: [
      { injuryTier: null },
      { injuryTier: { in: ['LIGHT', 'MEDIUM'] } },
      { injuryUntil: null },
      { injuryUntil: { lte: now } },
    ],
  }
}

/** Минус к урону и увороту и множитель опыта на время травмы. */
export function injuryEffects(state: InjuryState, now = new Date()): { damage: number; dodge: number; exp: number } {
  const injury = activeInjury(state, now)
  const c = I()
  if (injury?.tier === 'LIGHT') return { damage: 1 - c.lightPenalty, dodge: 1 - c.lightPenalty, exp: c.lightExp }
  if (injury?.tier === 'MEDIUM') return { damage: 1 - c.mediumPenalty, dodge: 1 - c.mediumPenalty, exp: c.mediumExp }
  return { damage: 1, dodge: 1, exp: 1 }
}

export interface FightOutcome {
  won: boolean
}

/**
 * Бросок травмы проигравшему: шансы ступеней в процентах из конфига, на
 * остаток — без травмы. Если Дима поднимет шансы так, что сумма перевалит
 * за 100, «целым» не уйдёт никто, а ступени поделят бросок по весам.
 * Ничья травм не даёт — её отсекают раньше.
 */
export function rollFairInjury(fight: FightOutcome, roll = Math.random()): FairInjuryTier | null {
  if (fight.won) return null
  const c = I()
  const weights: [FairInjuryTier, number][] = [
    ['LIGHT', c.loserLight], ['MEDIUM', c.loserMedium], ['HEAVY', c.loserHeavy], ['CRITICAL', c.loserCritical],
  ]
  const injured = weights.reduce((sum, [, w]) => sum + Math.max(0, w), 0)
  let left = roll * Math.max(100, injured)
  for (const [tier, w] of weights) {
    left -= Math.max(0, w)
    if (left < 0) return tier
  }
  return null
}

/** Новая травма заменяет текущую, только если она тяжелее. */
export function injuryUpdate(state: InjuryState, tier: InjuryTier, now: Date) {
  const current = activeInjury(state, now)
  if (current && SEVERITY[current.tier] >= SEVERITY[tier]) return null
  return {
    injuryTier: tier,
    injuryUntil: new Date(now.getTime() + injuryMinutes(tier) * MINUTE),
    injuryTreatedAt: null,
    injuryAidCount: 0,
    injuryAidAt: null,
    injuryClinicUsed: 0,
    ...(tier === 'CRITICAL' || tier === 'COMA' ? { injuryCriticalAt: now } : {}),
  }
}

// ── Этап 2: засада, критическое, кома, реанимация ─────────────────

/** Критическое или кома: персонаж в реанимации, все действия закрыты. */
export function inReanimation(state: InjuryState, now = new Date()): boolean {
  const injury = activeInjury(state, now)
  return !!injury && (injury.tier === 'CRITICAL' || injury.tier === 'COMA')
}

/** Засада бьёт «на отключение»: критическое, а второе за сутки — кома. */
export function knockoutTier(state: InjuryState, now: Date): 'CRITICAL' | 'COMA' {
  const last = state.injuryCriticalAt
  return last && now.getTime() - last.getTime() < I().comaWindowHours * 3_600_000 ? 'COMA' : 'CRITICAL'
}

export type ReanimationChannel = 'SELF' | 'CLINIC' | 'BRIGADE'

/** Цена и сокращение по каналу. Платит пациент (SELF ₽, CLINIC $) или общак (BRIGADE ₽). */
export function reanimationOffer(tier: InjuryTier, channel: ReanimationChannel): { rubles?: number; dollars?: number; minutes: number } | null {
  const c = I()
  const coma = tier === 'COMA'
  if (tier !== 'CRITICAL' && !coma) return null
  if (channel === 'SELF') return coma ? { rubles: c.comaSelfRub, minutes: c.comaSelfMinutes } : { rubles: c.criticalSelfRub, minutes: c.criticalSelfMinutes }
  if (channel === 'CLINIC') return coma ? { dollars: c.comaClinicUsd, minutes: c.comaClinicMinutes } : { dollars: c.criticalClinicUsd, minutes: c.criticalClinicMinutes }
  return coma ? { rubles: c.comaAidRub, minutes: c.comaAidMinutes } : { rubles: c.criticalAidRub, minutes: c.criticalAidMinutes }
}

/** Раньше этого времени отлёжка не кончится, сколько ни плати. */
export function reanimationFloor(state: InjuryState): Date | null {
  const c = I()
  if (!state.injuryCriticalAt || (state.injuryTier !== 'CRITICAL' && state.injuryTier !== 'COMA')) return null
  const floor = state.injuryTier === 'COMA' ? c.comaFloorMinutes : c.criticalFloorMinutes
  return new Date(state.injuryCriticalAt.getTime() + floor * MINUTE)
}

/** Новое время выхода после сокращения или null, если сокращать уже некуда. */
export function shortenedUntil(state: InjuryState, minutes: number, now: Date): Date | null {
  const injury = activeInjury(state, now)
  const floor = reanimationFloor(state)
  if (!injury || !floor) return null
  const next = new Date(Math.max(floor.getTime(), now.getTime(), injury.until.getTime() - minutes * MINUTE))
  return next < injury.until ? next : null
}

export type AuthorityLevel = 'PASSENGER' | 'OWN' | 'FIGHTER' | 'TRUSTED'

export const AUTHORITY_TITLE: Record<AuthorityLevel, string> = {
  PASSENGER: 'Пассажир', OWN: 'Свой', FIGHTER: 'Боец', TRUSTED: 'Проверенный',
}

export function authorityLevel(points: number): AuthorityLevel {
  const c = I()
  if (points >= c.authorityTrusted) return 'TRUSTED'
  if (points >= c.authorityFighter) return 'FIGHTER'
  if (points >= c.authorityOwn) return 'OWN'
  return 'PASSENGER'
}

/** Сколько заявок из общака даёт авторитет на это состояние. */
export function brigadeAidLimit(points: number, tier: InjuryTier): number {
  const c = I()
  const level = authorityLevel(points)
  const coma = tier === 'COMA'
  if (level === 'TRUSTED') return coma ? c.comaAidTrusted : c.criticalAidTrusted
  if (level === 'FIGHTER') return coma ? c.comaAidFighter : c.criticalAidFighter
  if (level === 'OWN') return coma ? c.comaAidOwn : c.criticalAidOwn
  return coma ? c.comaAidPassenger : c.criticalAidPassenger
}

/** Очки авторитета за взнос в общак: по 2 за каждую полную тысячу. */
export function authorityForDeposit(rubles: number): number {
  return Math.floor(rubles / 1000) * I().authorityPer1000
}

/** Шанс засады: середина ± ловкость, травмы сторон двигают шанс. */
export function ambushChance(attackerAgi: number, targetAgi: number, attacker: InjuryState, target: InjuryState, now = new Date()): number {
  const c = I()
  const raw = c.ambushBase + (attackerAgi - targetAgi) * c.ambushAgiStep
    - (1 - injuryEffects(attacker, now).damage) + (1 - injuryEffects(target, now).dodge)
  return Math.min(c.ambushMax, Math.max(c.ambushMin, raw))
}

/** Травмпункт: цена в ₽ и ожидание после оплаты. */
export function hospitalOffer(tier: InjuryTier): { rubles: number; waitMinutes: number } | null {
  const c = I()
  if (tier === 'LIGHT') return { rubles: c.lightHospitalRub, waitMinutes: c.lightHospitalWaitMinutes }
  if (tier === 'MEDIUM') return { rubles: c.mediumHospitalRub, waitMinutes: c.mediumHospitalWaitMinutes }
  if (tier === 'HEAVY') return { rubles: c.heavyHospitalRub, waitMinutes: c.heavyHospitalWaitMinutes }
  return null
}

/** ЧМЦ: доллары, готов сразу. Лёгкую не принимает. */
export function clinicOffer(tier: InjuryTier): { dollars: number } | null {
  const c = I()
  if (tier === 'MEDIUM') return { dollars: c.mediumClinicUsd }
  if (tier === 'HEAVY') return { dollars: c.heavyClinicUsd }
  return null
}

/** Уведомление пострадавшему в засаде (раздел 13). */
export function knockoutNotice(tier: 'CRITICAL' | 'COMA'): string {
  const c = I()
  return tier === 'COMA'
    ? `💀 Вы в коме. Второй раз за сутки вас выносят на носилках — и организм сдаётся. Реанимация: бои, экономика и перемещение закрыты, вещи сохранены. Время в коме: ${hours(c.comaMinutes)}.`
    : `🚨 Вы в критическом состоянии. Последнее, что помните — вой сирены. Вас доставили в реанимацию: все действия закрыты, вещи сохранены, покинуть реанимацию нельзя. Отлёжка: ${hours(c.criticalMinutes)}.`
}

/** Уведомления из раздела 13 документа. */
export function injuryNotice(tier: FairInjuryTier): string {
  const c = I()
  if (tier === 'CRITICAL') return knockoutNotice('CRITICAL')
  if (tier === 'LIGHT') {
    return `🩹 Вы получили лёгкие травмы. Потрепали вас прилично, но на ногах стоите. Опыт за бои: ×${fmt(c.lightExp)}. Отлёжка: ${c.lightMinutes} мин — или травмпункт больницы.`
  }
  if (tier === 'MEDIUM') {
    return `🤕 Вы получили средние травмы. Рёбра хрустят, каждое движение — через силу. Опыт за бои: ×${fmt(c.mediumExp)}. Отлёжка: ${hours(c.mediumMinutes)} — или травмпункт больницы.`
  }
  return `🩸 Вы получили тяжёлые травмы. Ты жив, но серьёзно избит. Бои заблокированы, работы, продажа, покупка, ремонт и перемещение доступны. Отлёжка: ${hours(c.heavyMinutes)} — или травмпункт больницы. На вас нельзя напасть, но и ответить вы не сможете.`
}

function fmt(n: number): string {
  return String(n).replace('.', ',')
}

function hours(minutes: number): string {
  if (minutes % 60) return `${minutes} мин`
  const h = minutes / 60
  return h === 1 ? '1 час' : h < 5 ? `${h} часа` : `${h} часов`
}
