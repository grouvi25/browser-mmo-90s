import { describe, expect, it } from 'vitest'
import { buffTotals, effectText, liveEffects, parseUseEffect, regenPercentAt, withAppliedEffect } from '../../modules/items/item-effects'
import { TABLE_ITEM_EFFECTS, TABLE_ITEMS } from '../../../prisma/economy-table'

const now = new Date('2026-11-06T12:00:00Z')
const item = { code: 'tb_item_w02', name: 'Свиток защиты' }

describe('эффекты настоек и свитков', () => {
  it('чужеродное в шаблоне не считается эффектом', () => {
    expect(parseUseEffect(null)).toBeNull()
    expect(parseUseEffect({})).toBeNull()
    expect(parseUseEffect({ buffs: [{ stat: 'unknown', value: 1 }], minutes: 10 })).toBeNull()
    // Усиление без срока действовало бы вечно.
    expect(parseUseEffect({ buffs: [{ stat: 'armor', value: 0.1 }] })).toBeNull()
    expect(parseUseEffect({ directDamage: 60 })).toEqual({ directDamage: 60 })
  })

  it('настойка считается минутами и работает вне боя', () => {
    const list = withAppliedEffect([], item, { buffs: [{ stat: 'damage', value: 0.1 }], minutes: 10 }, now)
    expect(liveEffects(list, new Date(now.getTime() + 9 * 60_000))).toHaveLength(1)
    expect(liveEffects(list, new Date(now.getTime() + 10 * 60_000))).toHaveLength(0)
  })

  it('свиток на 3 раунда действует ровно три раунда и только в своём бою', () => {
    const battle = { battleId: 'b1', round: 5 }
    const list = withAppliedEffect([], item, { buffs: [{ stat: 'armor', value: 0.15 }], rounds: 3 }, now, battle)
    expect(liveEffects(list, now, { battleId: 'b1', round: 5 })).toHaveLength(1)
    expect(liveEffects(list, now, { battleId: 'b1', round: 7 })).toHaveLength(1)
    expect(liveEffects(list, now, { battleId: 'b1', round: 8 })).toHaveLength(0)
    expect(liveEffects(list, now, { battleId: 'b2', round: 5 })).toHaveLength(0)
    expect(liveEffects(list, now)).toHaveLength(0)
  })

  it('повтор той же вещи заменяет эффект, срок идёт заново', () => {
    const first = withAppliedEffect([], item, { buffs: [{ stat: 'armor', value: 0.15 }], minutes: 10 }, now)
    const later = new Date(now.getTime() + 5 * 60_000)
    const second = withAppliedEffect(first, item, { buffs: [{ stat: 'armor', value: 0.15 }], minutes: 10 }, later)
    expect(second).toHaveLength(1)
    expect(second[0].expiresAt).toBe(new Date(later.getTime() + 10 * 60_000).toISOString())
  })

  it('на одну характеристику берётся сильнейший эффект, разные не мешают', () => {
    const list = [
      { code: 'a', name: 'a', buffs: [{ stat: 'accuracy' as const, value: 0.1 }] },
      { code: 'b', name: 'b', buffs: [{ stat: 'accuracy' as const, value: 0.25 }, { stat: 'armor' as const, value: 0.2 }] },
    ]
    expect(buffTotals(list)).toMatchObject({ accuracy: 0.25, armor: 0.2, damage: 0 })
  })

  it('лечение за раунд не срабатывает второй раз в раунд применения', () => {
    const battle = { battleId: 'b1', round: 2 }
    const list = withAppliedEffect([], item, { regenPercent: 6, rounds: 4 }, now, battle)
    expect(regenPercentAt(list, 2)).toBe(0)
    expect(regenPercentAt(list, 3)).toBe(6)
    expect(liveEffects(list, now, { battleId: 'b1', round: 5 })).toHaveLength(1)
    expect(liveEffects(list, now, { battleId: 'b1', round: 6 })).toHaveLength(0)
  })

  it('текст понятен игроку', () => {
    expect(effectText({ buffs: [{ stat: 'armor', value: 0.2 }, { stat: 'damage', value: 0.2 }], rounds: 3 })).toBe('броня +20%, урон +20% на 3 раунда')
    expect(effectText({ buffs: [{ stat: 'agi', value: 2 }], minutes: 10 })).toBe('ловкость +2 на 10 мин')
    expect(effectText({ directDamage: 60 })).toBe('60 урона врагу мимо брони')
  })

  it('каждая вещь таблицы с эффектом существует, и эффект читается', () => {
    const codes = new Set(TABLE_ITEMS.map(row => row.code))
    for (const [code, effect] of Object.entries(TABLE_ITEM_EFFECTS)) {
      expect(codes.has(code), code).toBe(true)
      expect(parseUseEffect(effect), code).not.toBeNull()
    }
  })

  it('в таблице не осталось расходника без действия', () => {
    const silent = TABLE_ITEMS
      .filter(row => row.group !== 'clothes' && !TABLE_ITEM_EFFECTS[row.code] && !row.healPercent && !row.soberAmount)
      .map(row => row.code)
    expect(silent).toEqual([])
  })

  it('свиток прорыва сгорает на первом попадании', () => {
    const battle = { battleId: 'b1', round: 2, hitsLanded: 4 }
    const list = withAppliedEffect([], item, { buffs: [{ stat: 'nextHit', value: 0.25 }], rounds: 3 }, now, battle)
    expect(liveEffects(list, now, { battleId: 'b1', round: 3, hitsLanded: 4 })).toHaveLength(1)
    expect(liveEffects(list, now, { battleId: 'b1', round: 3, hitsLanded: 5 })).toHaveLength(0)
    expect(liveEffects(list, now, { battleId: 'b1', round: 5, hitsLanded: 4 })).toHaveLength(0)
  })
})
