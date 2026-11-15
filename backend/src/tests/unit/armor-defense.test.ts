import { describe, it, expect } from 'vitest'
import { calcArmorFlat, resolveZonalAttack, type AttackerSnapshot, type DefenderSnapshot } from '../../modules/battles/battle.formulas'

// Дима 15.11: броня единицами вычитается из удара; мастерство защиты 250% — урон в ноль.
const attacker = (o: Partial<AttackerSnapshot> = {}): AttackerSnapshot => ({
  str: 0, acc: 10, agi: 200, rea: 5, luck: 0, agr: 0, end: 5, weaponSkillLevel: 0,
  minDamage: 100, maxDamage: 100, weaponAccuracy: 0.9, critBonus: 0, critDamageBonus: 0, blockPierce: 0,
  flatDamageBonus: 0, equipmentWeight: 0, antiDodgeBonus: 0, antiCounterBonus: 0, ...o,
})
const defender = (o: Partial<DefenderSnapshot> = {}): DefenderSnapshot => ({
  agi: 0, rea: 0, end: 0, luck: 0, agr: 200, armor: 0, dodgeBonus: 0, antiCrit: 0, blockBonus: 0, armorWeight: 0,
  antiSkillLevel: 0, antiCounterDefense: 0, antiLuck: 0, minDamage: 5, maxDamage: 5, ...o,
})
const avg = (d: DefenderSnapshot, zoneArmor: number) => {
  let sum = 0
  for (let i = 0; i < 400; i++) sum += resolveZonalAttack(attacker(), d, { zone: 'CHEST', blockedZones: [], zoneArmor }).finalDamage
  return sum / 400
}

describe('броня единицами и мастерство защиты', () => {
  it('броня зоны плюс половина выносливости', () => {
    expect(calcArmorFlat(34, 18)).toBe(43)
    expect(calcArmorFlat(-5, 0)).toBe(0)
  })
  it('больше брони — меньше урона, броня больше удара — урон 0', () => {
    const none = avg(defender(), 0), some = avg(defender(), 50)
    expect(some).toBeLessThan(none * 0.6)
    expect(avg(defender(), 5000)).toBe(0)
  })
  it('защита 250% (множитель 0) — урон 0, половина — вдвое меньше', () => {
    expect(avg(defender({ incomingDamageMultiplier: 0 }), 0)).toBe(0)
    const half = avg(defender({ incomingDamageMultiplier: 0.5 }), 0), full = avg(defender(), 0)
    expect(half).toBeGreaterThan(full * 0.4)
    expect(half).toBeLessThan(full * 0.6)
  })
})
