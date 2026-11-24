/**
 * Травмы после честных боёв — документ Димы «Механика травм, лечения и
 * помощи» v8 (24.11), раздел I. Только Стрелки: дуэль и групповая заявка.
 *
 * Ступень выпадает по доле HP, потерянной за бой (урон / максимум HP):
 * полбака потерял — полбака и у танка, и у «стеклянной пушки». Победитель
 * может получить только лёгкую. Оверкилл — последний удар перекрыл остаток
 * HP на половину максимума и больше — тяжёлая без броска.
 *
 * Все числа в BalanceConfig.injuries: Дима правит их из админки.
 */
import type { InjuryTier, Prisma } from '@prisma/client'
import { BalanceConfig } from '../../config/balance.config'

const MINUTE = 60_000
const I = () => BalanceConfig.injuries

/** Ступени первого этапа. Критическое и кома придут с засадами. */
export type FairInjuryTier = Extract<InjuryTier, 'LIGHT' | 'MEDIUM' | 'HEAVY'>

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
}

export function injuryMinutes(tier: InjuryTier): number {
  const c = I()
  if (tier === 'LIGHT') return c.lightMinutes
  if (tier === 'MEDIUM') return c.mediumMinutes
  if (tier === 'HEAVY') return c.heavyMinutes
  return 0
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
  /** HP, потерянные за бой. */
  damageReceived: number
  hpMax: number
  /** Последний удар перекрыл остаток HP на долю максимума не меньше порога. */
  overkill?: boolean
}

function pick(weights: [FairInjuryTier | null, number][], roll: number): FairInjuryTier | null {
  const total = weights.reduce((sum, [, w]) => sum + Math.max(0, w), 0)
  if (total <= 0) return null
  let left = roll * total
  for (const [tier, w] of weights) {
    left -= Math.max(0, w)
    if (left < 0) return tier
  }
  return weights[weights.length - 1][0]
}

/** Бросок ступени по таблицам v8. Ничья травм не даёт — её отсекают раньше. */
export function rollFairInjury(fight: FightOutcome, roll = Math.random()): FairInjuryTier | null {
  const c = I()
  const share = fight.hpMax > 0 ? fight.damageReceived / fight.hpMax : 0
  if (fight.won) {
    const light = share >= c.winnerHighFrom ? c.winnerHighLight : share >= c.winnerMidFrom ? c.winnerMidLight : c.winnerLowLight
    return pick([['LIGHT', light], [null, 100 - light]], roll)
  }
  if (fight.overkill) return 'HEAVY'
  if (share >= c.loserHighFrom) return pick([['LIGHT', c.loserHighLight], ['MEDIUM', c.loserHighMedium], ['HEAVY', c.loserHighHeavy]], roll)
  if (share >= c.loserMidFrom) return pick([['LIGHT', c.loserMidLight], ['MEDIUM', c.loserMidMedium], ['HEAVY', c.loserMidHeavy]], roll)
  return pick([['LIGHT', c.loserLowLight], ['MEDIUM', c.loserLowMedium], ['HEAVY', c.loserLowHeavy]], roll)
}

/** Удар, который снял цель: перекрыл ли он остаток HP на порог оверкилла. */
export function isOverkill(hpBefore: number, damage: number, hpMax: number): boolean {
  return hpBefore > 0 && damage >= hpBefore && damage - hpBefore >= I().overkillShare * hpMax
}

/** Новая травма заменяет текущую, только если она тяжелее. */
export function injuryUpdate(state: InjuryState, tier: InjuryTier, now: Date) {
  const current = activeInjury(state, now)
  if (current && SEVERITY[current.tier] >= SEVERITY[tier]) return null
  return {
    injuryTier: tier,
    injuryUntil: new Date(now.getTime() + injuryMinutes(tier) * MINUTE),
    injuryTreatedAt: null,
  }
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

/** Уведомления из раздела 13 документа. */
export function injuryNotice(tier: FairInjuryTier): string {
  const c = I()
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
