// Правила осады дома бригады без зависимостей от сервисов: их читают и
// осада, и бонусы районов, и тесты — без круговых импортов.
import { BalanceConfig } from '../../config/balance.config'

const S = BalanceConfig.strategy.houseSiege
const HOUR = 3_600_000
/** Москва без перехода на летнее время: UTC+3 круглый год. */
const MSK = 3 * HOUR

export const when = (date: Date) =>
  new Date(date.getTime() + MSK).toISOString().slice(0, 16).replace('T', ' ').replace(/^(\d{4})-(\d\d)-(\d\d)/, '$3.$2.$1')

/** Бой осады — ровно через leadHours после заявки (правка заказчика 22.10). */
export function siegeStartsAt(now = new Date()): Date {
  return new Date(now.getTime() + S.leadHours * HOUR)
}

/** Правила осады для экрана: числа берутся из баланса, а не из текста. */
export function siegeRules() {
  return {
    leadHours: S.leadHours, traumaHours: S.traumaHours, cooldownDays: S.cooldownDays, razedDays: S.razedDays,
    durabilityLoss: S.durabilityLoss, maxPerSide: S.maxPerSide,
  }
}

/** Дом без бонусов: разгромлен или слишком разрушен. */
export function houseBonusesOff(clan: { houseDurability: number; houseRazedUntil: Date | null }, now = new Date()): boolean {
  return clan.houseDurability <= S.bonusesOffAtOrBelow || (!!clan.houseRazedUntil && clan.houseRazedUntil > now)
}
