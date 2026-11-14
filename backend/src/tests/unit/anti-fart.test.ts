import { describe, it, expect } from 'vitest'
import { resolveZonalAttack, calcAntiFartChance, type AttackerSnapshot, type DefenderSnapshot } from '../../modules/battles/battle.formulas'

// Антифарт блокера (Nobody 14.11): 1 очко = 1% удержать удар мимо блока или удачный, до 20%.
const attacker = (o: Partial<AttackerSnapshot> = {}): AttackerSnapshot => ({
  str: 10, acc: 10, agi: 200, rea: 5, luck: 0, agr: 0, end: 5, weaponSkillLevel: 5,
  minDamage: 40, maxDamage: 40, weaponAccuracy: 0.9, critBonus: 0, critDamageBonus: 0, blockPierce: 0,
  flatDamageBonus: 0, equipmentWeight: 0, antiDodgeBonus: 0, antiCounterBonus: 0, ...o,
})
const defender = (o: Partial<DefenderSnapshot> = {}): DefenderSnapshot => ({
  agi: 0, rea: 0, end: 5, luck: 0, agr: 200, armor: 0, dodgeBonus: 0, antiCrit: 0, blockBonus: 0, armorWeight: 0,
  antiSkillLevel: 0, antiCounterDefense: 0, antiLuck: 0, minDamage: 5, maxDamage: 5, ...o,
})
const blockRate = (a: AttackerSnapshot, d: DefenderSnapshot, zone: 'HEAD' | 'CHEST', blockedZones: ('HEAD' | 'CHEST')[]) => {
  let blocked = 0
  for (let i = 0; i < 6000; i++) if (resolveZonalAttack(a, d, { zone, blockedZones, zoneArmor: 0 }).block) blocked++
  return blocked / 6000
}

describe('антифарт блокера', () => {
  it('1 очко = 1%, предел 20%', () => {
    expect(calcAntiFartChance({ aluck: 0 })).toBe(0)
    expect(calcAntiFartChance({ aluck: 10 })).toBeCloseTo(0.1)
    expect(calcAntiFartChance({ aluck: 100 })).toBeCloseTo(0.2)
  })
  it('держит удар в открытую зону около 20%, если блок выставлен', () => {
    expect(blockRate(attacker(), defender({ aluck: 50 }), 'CHEST', ['HEAD'])).toBeGreaterThan(0.17)
    expect(blockRate(attacker(), defender({ aluck: 50 }), 'CHEST', ['HEAD'])).toBeLessThan(0.23)
  })
  it('без блока и без антифарта не срабатывает', () => {
    expect(blockRate(attacker(), defender({ aluck: 50 }), 'CHEST', [])).toBe(0)
    expect(blockRate(attacker(), defender(), 'CHEST', ['HEAD'])).toBe(0)
  })
  it('держит удачный, пробивший блок', () => {
    // фарт бьющего на 200 больше: удачный всегда, блок пробит; антифарт возвращает около 10%
    const rate = blockRate(attacker({ luck: 200 }), defender({ aluck: 10 }), 'CHEST', ['CHEST'])
    expect(rate).toBeGreaterThan(0.08)
    expect(rate).toBeLessThan(0.12)
  })
})
