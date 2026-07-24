import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  armorOfZone,
  normalizeTurn,
  legacyActionToTurn,
  botChooseTurn,
  STANCE_BUDGET,
  type EquipArmorLike,
} from '../../modules/battles/zones'
import {
  resolveZonalAttack,
  calcLuckyPierceChance,
  type AttackerSnapshot,
  type DefenderSnapshot,
} from '../../modules/battles/battle.formulas'

// ── helpers ──────────────────────────────────────────────
function attacker(overrides: Partial<AttackerSnapshot> = {}): AttackerSnapshot {
  return {
    str: 10, acc: 10, agi: 5, rea: 5, luck: 0, agr: 5, end: 5,
    weaponSkillLevel: 5,
    minDamage: 40, maxDamage: 40, weaponAccuracy: 0.9,
    critBonus: 0, critDamageBonus: 0, blockPierce: 0,
    flatDamageBonus: 0, equipmentWeight: 0,
    antiDodgeBonus: 0, antiCounterBonus: 0,
    ...overrides,
  }
}
function defender(overrides: Partial<DefenderSnapshot> = {}): DefenderSnapshot {
  return {
    agi: 0, rea: 0, end: 5, luck: 0,
    armor: 0, dodgeBonus: 0, antiCrit: 0, blockBonus: 0, armorWeight: 0,
    antiSkillLevel: 0, antiCounterDefense: 0,
    minDamage: 5, maxDamage: 5,
    ...overrides,
  }
}
// Мокаем Math.random фиксированной очередью (по кругу).
function mockRandom(seq: number[]) {
  let i = 0
  vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length])
}

afterEach(() => vi.restoreAllMocks())

// ── zones module (детерминированно) ──────────────────────
describe('zones: armorOfZone', () => {
  const equip: EquipArmorLike[] = [
    { armor: 10, slot: 'CHEST' },
    { armor: 4, slot: 'HEAD' },
    { armor: 6, slot: 'LEGS' },
    { armor: 6, slot: 'FEET' },
    { armor: 8, slot: 'RIGHT_HAND' }, // щит
  ]
  it('HEAD берёт шлем', () => expect(armorOfZone(equip, 'HEAD')).toBe(4))
  it('CHEST берёт корпусную броню', () => expect(armorOfZone(equip, 'CHEST')).toBe(10))
  it('LEGS = штаны + обувь', () => expect(armorOfZone(equip, 'LEGS')).toBe(12))
  it('RIGHT_ARM берёт щит', () => expect(armorOfZone(equip, 'RIGHT_ARM')).toBe(8))
  it('LEFT_ARM без перчаток = 0', () => expect(armorOfZone(equip, 'LEFT_ARM')).toBe(0))
})

describe('zones: normalizeTurn / stances', () => {
  it('attack2 = 2 удара, 0 блоков', () => {
    const t = normalizeTurn({ stance: 'attack2', attackZones: ['HEAD', 'CHEST', 'LEGS'] })
    expect(t.attackZones).toHaveLength(2)
    expect(t.blockZones).toHaveLength(0)
  })
  it('mixed = 1 удар + 1 блок', () => {
    const t = normalizeTurn({ stance: 'mixed', attackZones: ['HEAD'], blockZones: ['CHEST'] })
    expect(t.attackZones).toEqual(['HEAD'])
    expect(t.blockZones).toEqual(['CHEST'])
  })
  it('defense4 = 4 уникальных блока', () => {
    const t = normalizeTurn({ stance: 'defense4', blockZones: ['HEAD', 'HEAD', 'CHEST'] })
    expect(t.blockZones).toHaveLength(4)
    expect(new Set(t.blockZones).size).toBe(4)
  })
  it('добивает атаки корпусом до бюджета', () => {
    const t = normalizeTurn({ stance: 'attack2', attackZones: [] })
    expect(t.attackZones).toEqual(['CHEST', 'CHEST'])
  })

  it('movement consumes the turn and preserves its destination', () => {
    const t = normalizeTurn({
      stance: 'attack2',
      attackZones: ['HEAD', 'CHEST'],
      blockZones: ['LEGS'],
      moveTo: { x: 2, y: 2 },
      targetParticipantId: 'target-1',
    })
    expect(t.attackZones).toEqual([])
    expect(t.blockZones).toEqual([])
    expect(t.moveTo).toEqual({ x: 2, y: 2 })
    expect(t.targetParticipantId).toBe('target-1')
  })
})

describe('zones: legacyActionToTurn', () => {
  it('block → defense4 (4 блока)', () => {
    const t = legacyActionToTurn('block')
    expect(t.stance).toBe('defense4')
    expect(t.blockZones).toHaveLength(4)
  })
  it('attack → attack2 (2 удара)', () => {
    const t = legacyActionToTurn('attack')
    expect(t.stance).toBe('attack2')
    expect(t.attackZones).toHaveLength(2)
  })
})

describe('zones: botChooseTurn соблюдает бюджет', () => {
  it('для любого rng бюджет стойки выдержан', () => {
    for (const r of [0.1, 0.3, 0.6, 0.7, 0.9]) {
      const t = botChooseTurn(() => r)
      const b = STANCE_BUDGET[t.stance]
      expect(t.attackZones.length).toBe(b.attacks)
      expect(t.blockZones.length).toBe(b.blocks)
    }
  })
})

// ── resolveZonalAttack ───────────────────────────────────
describe('resolveZonalAttack: блок гасит зону в 0', () => {
  it('заблокированная зона без удачи → block, 0 урона', () => {
    // seq: dodge(0.99 нет), lucky(0.99 нет), crit(0.99 нет), weaponRoll(0.5)
    mockRandom([0.99, 0.99, 0.99, 0.5])
    const r = resolveZonalAttack(attacker({ luck: 0 }), defender({ rea: 0 }), {
      zone: 'HEAD', blockedZones: ['HEAD', 'CHEST'], zoneArmor: 0,
    })
    expect(r.block).toBe(true)
    expect(r.blockPierced).toBe(false)
    expect(r.finalDamage).toBe(0)
  })
})

describe('resolveZonalAttack: удачный удар пробивает блок и броню', () => {
  it('lucky → blockPierced, урон проходит мимо брони', () => {
    // dodge нет (0.99); lucky да (0.0 < luckyChance); crit нет (0.99); weaponRoll(0.5)
    mockRandom([0.99, 0.0, 0.99, 0.5])
    const atk = attacker({ luck: 25, minDamage: 40, maxDamage: 40, str: 0, weaponSkillLevel: 0 })
    expect(calcLuckyPierceChance(atk.luck)).toBeGreaterThan(0)
    const r = resolveZonalAttack(atk, defender({ armor: 1000, end: 1, rea: 0 }), {
      zone: 'HEAD', blockedZones: ['HEAD'], zoneArmor: 1000,
    })
    expect(r.blockPierced).toBe(true)
    expect(r.block).toBe(false)
    // огромная броня зоны проигнорирована lucky-ударом → урон существенный
    expect(r.finalDamage).toBeGreaterThan(20)
  })
})

describe('resolveZonalAttack: незаблокированная зона получает урон, броня зоны снижает', () => {
  it('высокая броня зоны снижает урон сильнее нулевой', () => {
    const seq = [0.99, 0.99, 0.99, 0.5] // no dodge, no lucky, no crit, weaponRoll mid
    mockRandom(seq)
    const noArmor = resolveZonalAttack(attacker({ luck: 0 }), defender({ end: 1 }), {
      zone: 'CHEST', blockedZones: [], zoneArmor: 0,
    })
    mockRandom(seq)
    const highArmor = resolveZonalAttack(attacker({ luck: 0 }), defender({ end: 1 }), {
      zone: 'CHEST', blockedZones: [], zoneArmor: 60,
    })
    expect(noArmor.hit).toBe(true)
    expect(noArmor.block).toBe(false)
    expect(highArmor.finalDamage).toBeLessThan(noArmor.finalDamage)
  })
})
