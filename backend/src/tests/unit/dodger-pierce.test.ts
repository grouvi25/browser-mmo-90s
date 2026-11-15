import { describe, it, expect } from 'vitest'
import { resolveZonalAttack, type AttackerSnapshot, type DefenderSnapshot } from '../../modules/battles/battle.formulas'

// Ловкач (Nobody и Дима 15.11): крит и удачный пробивают 100% уворот, если у бьющего
// минус-оберег больше оберега ловкача и стат выше (агрессия для крита, фарт для удачного).
const attacker = (o: Partial<AttackerSnapshot> = {}): AttackerSnapshot => ({
  str: 0, acc: 0, agi: 0, rea: 0, luck: 0, agr: 0, end: 0, weaponSkillLevel: 0,
  minDamage: 50, maxDamage: 50, weaponAccuracy: 0.9, critBonus: 0, critDamageBonus: 0, blockPierce: 0,
  flatDamageBonus: 0, equipmentWeight: 0, antiDodgeBonus: 0, antiCounterBonus: 0, ...o,
})
const dodger = (o: Partial<DefenderSnapshot> = {}): DefenderSnapshot => ({
  agi: 200, rea: 0, end: 0, luck: 0, agr: 0, armor: 0, dodgeBonus: 0, antiCrit: 0, blockBonus: 0, armorWeight: 0,
  antiSkillLevel: 0, antiCounterDefense: 0, antiLuck: 0, minDamage: 5, maxDamage: 5, ...o,
})
const run = (a: AttackerSnapshot, d: DefenderSnapshot) => {
  const out = { hits: 0, crits: 0, lucky: 0 }
  for (let i = 0; i < 3000; i++) {
    const r = resolveZonalAttack(a, d, { zone: 'CHEST', blockedZones: [], zoneArmor: 0 })
    if (r.hit) { out.hits++; if (r.crit) out.crits++; if (r.lucky) out.lucky++ }
  }
  return out
}

describe('ловкач: крит и удачный сквозь уворот', () => {
  it('без перевеса по минус-оберегам ловкач уворачивается всегда', () => {
    expect(run(attacker({ agr: 100, luck: 100 }), dodger()).hits).toBe(0)
  })
  it('минус-оберег крита больше и агрессия выше: часть ударов проходит, и все они криты', () => {
    const r = run(attacker({ agr: 30 }), dodger({ critCharmEdge: -1 }))
    expect(r.hits).toBeGreaterThan(0)
    expect(r.hits).toBeLessThan(3000)
    expect(r.crits).toBe(r.hits)
  })
  it('агрессия не выше — крит сквозь уворот не проходит, даже с минус-оберегом', () => {
    expect(run(attacker({ agr: 0 }), dodger({ critCharmEdge: -1 })).hits).toBe(0)
  })
  it('минус-оберег удачи больше и фарт выше: проходят удачные', () => {
    const r = run(attacker({ luck: 30 }), dodger({ luckCharmEdge: -1 }))
    expect(r.hits).toBeGreaterThan(0)
    expect(r.lucky).toBe(r.hits)
  })
})
