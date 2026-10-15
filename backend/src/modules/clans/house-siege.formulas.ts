// Правила осады дома бригады без зависимостей от сервисов: их читают и
// осада, и бонусы районов, и тесты — без круговых импортов.
import { BalanceConfig } from '../../config/balance.config'

const S = BalanceConfig.strategy.houseSiege
const HOUR = 3_600_000
const DAY = 24 * HOUR
/** Москва без перехода на летнее время: UTC+3 круглый год. */
const MSK = 3 * HOUR

export const when = (date: Date) =>
  new Date(date.getTime() + MSK).toISOString().slice(0, 16).replace('T', ' ').replace(/^(\d{4})-(\d\d)-(\d\d)/, '$3.$2.$1')

function leadText(): string {
  return S.minLeadHours % 24 === 0 ? `${S.minLeadHours / 24} суток` : `${S.minLeadHours} ч`
}

/** Правила осады для экрана: числа берутся из баланса, а не из текста. */
export function siegeRules() {
  return {
    minLead: leadText(), maxLeadDays: S.maxLeadDays,
    fromHour: S.windowFromHour, toHour: S.windowToHour, weekdaysOnly: S.weekdaysOnly,
    traumaHours: S.traumaHours, cooldownDays: S.cooldownDays, razedDays: S.razedDays,
    durabilityLoss: S.durabilityLoss, maxPerSide: S.maxPerSide,
  }
}

/** Разрешено ли начать осаду в это время (окно по Москве и будни). */
export function siegeStartAllowed(startsAt: Date, now = new Date()): string | null {
  const lead = startsAt.getTime() - now.getTime()
  if (lead < S.minLeadHours * HOUR) return `Осада начинается не раньше чем через ${leadText()}`
  if (lead > S.maxLeadDays * DAY) return `Осада начинается не позже чем через ${S.maxLeadDays} суток`
  const msk = new Date(startsAt.getTime() + MSK)
  const day = msk.getUTCDay()
  if (S.weekdaysOnly && (day === 0 || day === 6)) return 'Осады идут только в будни'
  const hour = msk.getUTCHours()
  if (hour < S.windowFromHour || hour >= S.windowToHour) {
    return `Начало осады — с ${S.windowFromHour}:00 до ${S.windowToHour}:00 по Москве`
  }
  return null
}

/** Дом без бонусов: разгромлен или слишком разрушен. */
export function houseBonusesOff(clan: { houseDurability: number; houseRazedUntil: Date | null }, now = new Date()): boolean {
  return clan.houseDurability <= S.bonusesOffAtOrBelow || (!!clan.houseRazedUntil && clan.houseRazedUntil > now)
}
