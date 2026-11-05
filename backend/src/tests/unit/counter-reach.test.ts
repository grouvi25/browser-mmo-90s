/**
 * Обращение 20: бот заблокировал выстрелы и «ответил» через всё поле, уже без оружия,
 * а журнал об этом молчал, и смерть игрока ничем не объяснялась.
 */
import { describe, expect, it } from 'vitest'
import { describeTurn } from '../../modules/battles/battle-journal'
import { executeStrikes } from '../../modules/battles/battles.service'

const attacker = {
  str: 10, acc: 10, agi: 5, rea: 5, luck: 0, agr: 5, end: 5, weaponSkillLevel: 5, minDamage: 40, maxDamage: 40, weaponAccuracy: 0.9,
  critBonus: 0, critDamageBonus: 0, blockPierce: 0, flatDamageBonus: 0, equipmentWeight: 0, antiDodgeBonus: 0, antiCounterBonus: 0,
}
const defender = {
  agi: 0, rea: 100, end: 5, luck: 0, armor: 0, dodgeBonus: 0, antiCrit: 0, blockBonus: 0, armorWeight: 0,
  antiSkillLevel: 0, antiCounterDefense: 0, antiLuck: 0, minDamage: 40, maxDamage: 40,
}

// Ответка случайна: шанс при такой реакции около 40%, серия из 80 ударов её не минует.
function series(counterReach?: { distance: number; range: number }) {
  return Array.from({ length: 80 }, () => executeStrikes({
    attackerSnap: attacker, defenderSnap: defender, zoneArmorFor: () => 0, attackZones: ['HEAD'], blockedZones: ['HEAD', 'HEAD'], defenderHp: 100, counterReach,
  }))
}

describe('Ответка', () => {
  it('в пределах оружия защитника работает', () => {
    expect(series({ distance: 1, range: 1 }).some(res => res.counterToAttacker > 0)).toBe(true)
    expect(series({ distance: 5, range: 5 }).some(res => res.counterToAttacker > 0)).toBe(true)
  })
  it('за пределами оружия её нет, ни в уроне, ни в записи', () => {
    for (const res of series({ distance: 5, range: 1 })) {
      expect(res.counterToAttacker).toBe(0)
      expect(res.results[0].counterDamage).toBe(0)
      expect(res.results[0].logParts.join(' ')).not.toContain('ответка')
    }
  })
})

describe('Журнал', () => {
  const turn = (logLine: string) => ({ action: 'ATTACK', zone: 'HEAD', hit: true, block: true, ranged: true, finalDamage: 0, logLine }) as never
  it('показывает ответку на блоке', () => {
    expect(describeTurn(turn('Блок (голова) + ответка 35')).text).toBe('выстрел в голову — блок, ответка −35 HP')
  })
  it('без ответки пишет просто блок', () => {
    expect(describeTurn(turn('Блок (голова)')).text).toBe('выстрел в голову — блок')
  })
})
