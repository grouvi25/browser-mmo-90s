import { describe, expect, it } from 'vitest'
import { normalizeTurn } from '../../modules/battles/zones'

describe('руки в ходе', () => {
  it('одной правой рукой нельзя ударить сразу в руку и корпус', () => {
    const turn = normalizeTurn({
      stance: 'attack2', attackZones: ['RIGHT_ARM', 'CHEST'], attackHands: ['RIGHT_HAND', 'RIGHT_HAND'], blockZones: [],
    })
    expect(turn.attackHands).toEqual(['RIGHT_HAND', 'LEFT_HAND'])
    expect(turn.attackZones).toEqual(['RIGHT_ARM', 'CHEST'])
  })

  it('двумя руками в одну зону можно', () => {
    const turn = normalizeTurn({
      stance: 'attack2', attackZones: ['CHEST', 'CHEST'], attackHands: ['LEFT_HAND', 'RIGHT_HAND'], blockZones: [],
    })
    expect(turn.attackHands).toEqual(['LEFT_HAND', 'RIGHT_HAND'])
    expect(turn.attackZones).toEqual(['CHEST', 'CHEST'])
  })

  it('недостающая рука добивается свободной', () => {
    const turn = normalizeTurn({ stance: 'attack2', attackZones: ['HEAD'], attackHands: ['RIGHT_HAND'], blockZones: [] })
    expect(turn.attackHands).toEqual(['RIGHT_HAND', 'LEFT_HAND'])
    expect(normalizeTurn({ stance: 'mixed', attackZones: ['HEAD'], blockZones: [] }).attackHands).toEqual(['LEFT_HAND'])
  })
})
