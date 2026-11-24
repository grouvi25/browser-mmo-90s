import { describe, expect, it } from 'vitest'
import {
  blocksCombat, clinicOffer, hospitalOffer, injuryEffects, injuryUpdate, isOverkill, rollFairInjury,
} from '../../modules/battles/injuries.formulas'

const now = new Date('2026-11-24T12:00:00Z')
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000)

describe('травмы v8: выпадение в честном бою', () => {
  it('проигравший до 40% HP: 70 / 25 / 5', () => {
    const fight = { won: false, damageReceived: 30, hpMax: 100 }
    expect(rollFairInjury(fight, 0)).toBe('LIGHT')
    expect(rollFairInjury(fight, 0.69)).toBe('LIGHT')
    expect(rollFairInjury(fight, 0.70)).toBe('MEDIUM')
    expect(rollFairInjury(fight, 0.94)).toBe('MEDIUM')
    expect(rollFairInjury(fight, 0.96)).toBe('HEAVY')
  })

  it('проигравший 40–70%: 30 / 50 / 20 и свыше 70%: 10 / 45 / 45', () => {
    const mid = { won: false, damageReceived: 40, hpMax: 100 }
    expect(rollFairInjury(mid, 0.29)).toBe('LIGHT')
    expect(rollFairInjury(mid, 0.79)).toBe('MEDIUM')
    expect(rollFairInjury(mid, 0.81)).toBe('HEAVY')
    const high = { won: false, damageReceived: 100, hpMax: 100 }
    expect(rollFairInjury(high, 0.09)).toBe('LIGHT')
    expect(rollFairInjury(high, 0.54)).toBe('MEDIUM')
    expect(rollFairInjury(high, 0.56)).toBe('HEAVY')
  })

  it('доля считается от максимума HP: танк и «стеклянная пушка» равны', () => {
    expect(rollFairInjury({ won: false, damageReceived: 500, hpMax: 1000 }, 0.81))
      .toBe(rollFairInjury({ won: false, damageReceived: 50, hpMax: 100 }, 0.81))
  })

  it('победитель получает только лёгкую: 10 / 25 / 50%', () => {
    expect(rollFairInjury({ won: true, damageReceived: 10, hpMax: 100 }, 0.09)).toBe('LIGHT')
    expect(rollFairInjury({ won: true, damageReceived: 10, hpMax: 100 }, 0.11)).toBeNull()
    expect(rollFairInjury({ won: true, damageReceived: 30, hpMax: 100 }, 0.24)).toBe('LIGHT')
    expect(rollFairInjury({ won: true, damageReceived: 30, hpMax: 100 }, 0.26)).toBeNull()
    expect(rollFairInjury({ won: true, damageReceived: 90, hpMax: 100 }, 0.49)).toBe('LIGHT')
    expect(rollFairInjury({ won: true, damageReceived: 90, hpMax: 100, overkill: true }, 0.51)).toBeNull()
  })

  it('оверкилл даёт проигравшему тяжёлую без броска', () => {
    expect(rollFairInjury({ won: false, damageReceived: 10, hpMax: 100, overkill: true }, 0)).toBe('HEAVY')
    expect(isOverkill(10, 60, 100)).toBe(true)
    expect(isOverkill(10, 59, 100)).toBe(false)
    expect(isOverkill(0, 100, 100)).toBe(false)
  })
})

describe('травмы v8: состояние и лечение', () => {
  it('лёгкая и средняя режут урон, уворот и опыт, тяжёлая закрывает бои', () => {
    expect(injuryEffects({ injuryTier: 'LIGHT', injuryUntil: later(30) }, now)).toEqual({ damage: 0.95, dodge: 0.95, exp: 0.2 })
    expect(injuryEffects({ injuryTier: 'MEDIUM', injuryUntil: later(60) }, now)).toEqual({ damage: 0.9, dodge: 0.9, exp: 0.1 })
    expect(injuryEffects({ injuryTier: 'MEDIUM', injuryUntil: later(-1) }, now)).toEqual({ damage: 1, dodge: 1, exp: 1 })
    expect(blocksCombat({ injuryTier: 'MEDIUM', injuryUntil: later(60) }, now)).toBe(false)
    expect(blocksCombat({ injuryTier: 'HEAVY', injuryUntil: later(120) }, now)).toBe(true)
    expect(blocksCombat({ injuryTier: 'HEAVY', injuryUntil: later(-1) }, now)).toBe(false)
  })

  it('новая травма заменяет только более лёгкую', () => {
    expect(injuryUpdate({}, 'LIGHT', now)).toEqual({ injuryTier: 'LIGHT', injuryUntil: later(30), injuryTreatedAt: null })
    expect(injuryUpdate({ injuryTier: 'MEDIUM', injuryUntil: later(5) }, 'LIGHT', now)).toBeNull()
    expect(injuryUpdate({ injuryTier: 'MEDIUM', injuryUntil: later(5) }, 'HEAVY', now)?.injuryUntil).toEqual(later(120))
    expect(injuryUpdate({ injuryTier: 'HEAVY', injuryUntil: later(-1) }, 'LIGHT', now)?.injuryTier).toBe('LIGHT')
  })

  it('цены травмпункта и ЧМЦ по документу', () => {
    expect(hospitalOffer('LIGHT')).toEqual({ rubles: 100, waitMinutes: 5 })
    expect(hospitalOffer('MEDIUM')).toEqual({ rubles: 250, waitMinutes: 10 })
    expect(hospitalOffer('HEAVY')).toEqual({ rubles: 500, waitMinutes: 10 })
    expect(clinicOffer('LIGHT')).toBeNull()
    expect(clinicOffer('MEDIUM')).toEqual({ dollars: 1 })
    expect(clinicOffer('HEAVY')).toEqual({ dollars: 2 })
  })
})
