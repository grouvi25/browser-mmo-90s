import { describe, expect, it } from 'vitest'
import {
  blocksCombat, clinicOffer, hospitalOffer, injuryEffects, injuryUpdate, rollFairInjury,
} from '../../modules/battles/injuries.formulas'
import { BalanceConfig } from '../../config/balance.config'

const now = new Date('2026-11-24T12:00:00Z')
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000)

describe('травмы: выпадение в честном бою (Дима 25.11)', () => {
  it('победитель травм не получает при любом броске', () => {
    for (const roll of [0, 0.01, 0.2, 0.36, 0.99]) expect(rollFairInjury({ won: true }, roll)).toBeNull()
  })

  it('проигравший: лёгкая 20%, средняя 10%, тяжёлая 5%, реанимация 2%, иначе целым', () => {
    const lost = { won: false }
    expect(rollFairInjury(lost, 0)).toBe('LIGHT')
    expect(rollFairInjury(lost, 0.1999)).toBe('LIGHT')
    expect(rollFairInjury(lost, 0.20)).toBe('MEDIUM')
    expect(rollFairInjury(lost, 0.2999)).toBe('MEDIUM')
    expect(rollFairInjury(lost, 0.30)).toBe('HEAVY')
    expect(rollFairInjury(lost, 0.3499)).toBe('HEAVY')
    expect(rollFairInjury(lost, 0.35)).toBe('CRITICAL')
    expect(rollFairInjury(lost, 0.3699)).toBe('CRITICAL')
    expect(rollFairInjury(lost, 0.37)).toBeNull()
    expect(rollFairInjury(lost, 0.9999)).toBeNull()
  })

  it('доли на миллионе бросков сходятся с шансами', () => {
    const counts: Record<string, number> = {}
    const n = 1_000_000
    for (let i = 0; i < n; i++) {
      const tier = rollFairInjury({ won: false }, (i + 0.5) / n) ?? 'NONE'
      counts[tier] = (counts[tier] ?? 0) + 1
    }
    expect(counts).toEqual({ LIGHT: 200_000, MEDIUM: 100_000, HEAVY: 50_000, CRITICAL: 20_000, NONE: 630_000 })
  })

  it('шансы из админки: сумма больше 100 делит бросок по весам, без «целым»', () => {
    const c = BalanceConfig.injuries
    const saved = { ...c }
    try {
      Object.assign(c, { loserLight: 100, loserMedium: 100, loserHeavy: 0, loserCritical: 0 })
      expect(rollFairInjury({ won: false }, 0.49)).toBe('LIGHT')
      expect(rollFairInjury({ won: false }, 0.51)).toBe('MEDIUM')
      expect(rollFairInjury({ won: false }, 0.9999)).toBe('MEDIUM')
    } finally {
      Object.assign(c, saved)
    }
  })

  it('с критическим из боя бои закрыты, как после засады', () => {
    const update = injuryUpdate({}, 'CRITICAL', now)!
    expect(update).toMatchObject({ injuryTier: 'CRITICAL', injuryCriticalAt: now })
    expect(blocksCombat(update, now)).toBe(true)
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
    expect(injuryUpdate({}, 'LIGHT', now)).toEqual({
      injuryTier: 'LIGHT', injuryUntil: later(30), injuryTreatedAt: null, injuryAidCount: 0, injuryAidAt: null, injuryClinicUsed: 0,
    })
    expect(injuryUpdate({ injuryTier: 'HEAVY', injuryUntil: later(5) }, 'CRITICAL', now)).toMatchObject({ injuryTier: 'CRITICAL', injuryUntil: later(240), injuryCriticalAt: now })
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

describe('травмы v8, этап 2: засада и реанимация', () => {
  it('второе критическое за сутки — кома', async () => {
    const { knockoutTier } = await import('../../modules/battles/injuries.formulas')
    expect(knockoutTier({}, now)).toBe('CRITICAL')
    expect(knockoutTier({ injuryCriticalAt: later(-23 * 60) }, now)).toBe('COMA')
    expect(knockoutTier({ injuryCriticalAt: later(-25 * 60) }, now)).toBe('CRITICAL')
  })

  it('сокращение отлёжки не опускается ниже минимума от начала', async () => {
    const { shortenedUntil, inReanimation } = await import('../../modules/battles/injuries.formulas')
    const state = { injuryTier: 'CRITICAL' as const, injuryUntil: later(240), injuryCriticalAt: now }
    expect(inReanimation(state, now)).toBe(true)
    expect(shortenedUntil(state, 60, now)).toEqual(later(180))
    expect(shortenedUntil(state, 600, now)).toEqual(later(60))
    expect(shortenedUntil({ ...state, injuryUntil: later(60) }, 60, now)).toBeNull()
    const coma = { injuryTier: 'COMA' as const, injuryUntil: later(720), injuryCriticalAt: now }
    expect(shortenedUntil(coma, 600, now)).toEqual(later(240))
  })

  it('авторитет: уровни, лимиты заявок и очки за взнос', async () => {
    const { authorityLevel, brigadeAidLimit, authorityForDeposit } = await import('../../modules/battles/injuries.formulas')
    expect(authorityLevel(99)).toBe('PASSENGER')
    expect(authorityLevel(100)).toBe('OWN')
    expect(authorityLevel(300)).toBe('FIGHTER')
    expect(authorityLevel(600)).toBe('TRUSTED')
    expect(brigadeAidLimit(0, 'CRITICAL')).toBe(1)
    expect(brigadeAidLimit(600, 'CRITICAL')).toBe(3)
    expect(brigadeAidLimit(600, 'COMA')).toBe(4)
    expect(authorityForDeposit(2999)).toBe(4)
  })

  it('шанс засады в пределах и зависит от ловкости', async () => {
    const { ambushChance } = await import('../../modules/battles/injuries.formulas')
    expect(ambushChance(10, 10, {}, {}, now)).toBeCloseTo(0.5)
    expect(ambushChance(15, 10, {}, {}, now)).toBeCloseTo(0.6)
    expect(ambushChance(100, 0, {}, {}, now)).toBe(0.8)
    expect(ambushChance(0, 100, {}, {}, now)).toBe(0.2)
    expect(ambushChance(10, 10, { injuryTier: 'MEDIUM', injuryUntil: later(30) }, {}, now)).toBeCloseTo(0.4)
  })
})
