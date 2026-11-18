import { describe, it, expect } from 'vitest'
import { resolveZonalAttack, type AttackerSnapshot, type DefenderSnapshot } from '../../modules/battles/battle.formulas'

// Антиметкость (№95, Дима 17.11 после боя с Monnarhh): выстрел, не прошедший меткость, —
// промах; его не пробивают ни крит, ни удачный, как обычный уворот.
const shooter = (o: Partial<AttackerSnapshot> = {}): AttackerSnapshot => ({
  str: 0, acc: 0, agi: 0, rea: 0, luck: 100, agr: 100, end: 0, weaponSkillLevel: 0,
  minDamage: 50, maxDamage: 50, weaponAccuracy: 0.9, critBonus: 0, critDamageBonus: 0, blockPierce: 0,
  flatDamageBonus: 0, equipmentWeight: 0, antiDodgeBonus: 0, antiCounterBonus: 0, ...o,
})
const target = (o: Partial<DefenderSnapshot> = {}): DefenderSnapshot => ({
  agi: 0, rea: 0, end: 0, luck: 0, agr: 0, armor: 0, dodgeBonus: 0, antiCrit: 0, blockBonus: 0, armorWeight: 0,
  antiSkillLevel: 0, antiCounterDefense: 0, antiLuck: 0, minDamage: 5, maxDamage: 5,
  // Крит и удачный «открыты»: будь это уворот, часть ударов прошла бы насквозь.
  critCharmEdge: -1, luckCharmEdge: -1, ...o,
})
const run = (a: AttackerSnapshot, d: DefenderSnapshot) => {
  let hits = 0, missLog = 0
  for (let i = 0; i < 3000; i++) {
    const r = resolveZonalAttack(a, d, { zone: 'CHEST', blockedZones: [], zoneArmor: 0 })
    if (r.hit) hits++
    if (r.logParts.some(p => p.startsWith('Промах: меткость'))) missLog++
  }
  return { hits, missLog }
}

describe('антиметкость против стрелка', () => {
  it('антиметкость сверху на 250% и больше: не попасть, крит и удачный не пробивают', () => {
    const r = run(shooter({ rangedAccEdge: -12.65 }), target())
    expect(r.hits).toBe(0)
    expect(r.missLog).toBe(3000)
  })
  it('половина перевеса — попаданий вдвое меньше, чем без антиметкости', () => {
    const open = target({ critCharmEdge: 0, luckCharmEdge: 0 })
    const half = run(shooter({ rangedAccEdge: -1.25 }), open).hits
    const full = run(shooter({ rangedAccEdge: 0 }), open).hits
    expect(half / full).toBeGreaterThan(0.4)
    expect(half / full).toBeLessThan(0.6)
  })
  it('ближний бой (без меткости) антиметкость не трогает', () => {
    const r = run(shooter({ rangedAccEdge: undefined }), target({ critCharmEdge: 0, luckCharmEdge: 0 }))
    expect(r.missLog).toBe(0)
  })
})
