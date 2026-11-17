import { describe, it, expect } from 'vitest'
import { resolveZonalAttack, type AttackerSnapshot, type DefenderSnapshot } from '../../modules/battles/battle.formulas'
import { describeTurn } from '../../modules/battles/battle-journal'

// №136 (Nobody): фарт и злость на 59 выше — каждый удар крито-удачный, но удачный
// в открытую зону не попадал в строку, и в просмотре боя был виден только «крит».
const attacker: AttackerSnapshot = {
  str: 0, acc: 0, agi: 60, rea: 0, luck: 60, agr: 60, end: 0, weaponSkillLevel: 0,
  minDamage: 10, maxDamage: 10, weaponAccuracy: 0.7, critBonus: 0, critDamageBonus: 0, blockPierce: 0,
  flatDamageBonus: 0, equipmentWeight: 0, antiDodgeBonus: 0, antiCounterBonus: 0,
}
const defender: DefenderSnapshot = {
  agi: 3, rea: 0, end: 0, luck: 1, agr: 1, armor: 0, dodgeBonus: 0, antiCrit: 0, blockBonus: 0, armorWeight: 0,
  antiSkillLevel: 0, antiCounterDefense: 0, antiLuck: 0, minDamage: 5, maxDamage: 5,
}

describe('удачный в открытую зону виден в журнале (№136)', () => {
  it('перевес фарта и злости 50+: удар крито-удачный и в журнале', () => {
    for (let i = 0; i < 50; i++) {
      const r = resolveZonalAttack(attacker, defender, { zone: 'CHEST', blockedZones: ['HEAD'], zoneArmor: 0 })
      expect(r.hit && r.crit && r.lucky).toBe(true)
      const turn = describeTurn({
        action: 'ATTACK', zone: 'CHEST', sourceHand: null, hit: r.hit, dodge: r.dodge, block: r.block,
        crit: r.crit, blockPierced: r.blockPierced, finalDamage: r.finalDamage, logLine: r.logParts.join(', '),
      })
      expect(turn.kind).toBe('critlucky')
    }
  })
  it('без перевеса фарта удачный не приписывается', () => {
    const r = resolveZonalAttack({ ...attacker, luck: 1 }, { ...defender, luck: 60 }, { zone: 'CHEST', blockedZones: [], zoneArmor: 0 })
    expect(r.lucky).toBe(false)
    expect(r.logParts.join(', ')).not.toMatch(/удачн/i)
  })
})
