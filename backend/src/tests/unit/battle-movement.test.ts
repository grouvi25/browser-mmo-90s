import { describe, expect, it } from 'vitest'
import { normalizeTurn } from '../../modules/battles/zones'
import {
  canMoveTo,
  gridDistance,
  stepAway,
  stepToward,
  type PositionedParticipant,
} from '../../modules/battles/grid'

const fighter = (id: string, side: number, x: number, y: number): PositionedParticipant => ({
  participantId: id, side, isAlive: true, position: { x, y },
})

// Повторяет логику resolveMoveDirToCell из сервиса:
// направление (approach/retreat) → валидная соседняя клетка относительно противника.
function pickMoveCell(
  self: PositionedParticipant,
  opponent: PositionedParticipant,
  dir: 'approach' | 'retreat',
  all: PositionedParticipant[],
) {
  const candidates = dir === 'approach'
    ? stepToward(self.position, opponent.position)
    : stepAway(self.position, opponent.position)
  return candidates.find(cell => canMoveTo(self, cell, all))
}

describe('нормализация направленного хода (moveDir)', () => {
  it('ход approach — это перемещение вместо удара: атаки и блоки обнуляются, dir пробрасывается', () => {
    const turn = normalizeTurn({ stance: 'attack2', attackZones: ['HEAD', 'CHEST'], moveDir: 'approach' })
    expect(turn.attackZones).toEqual([])
    expect(turn.blockZones).toEqual([])
    expect(turn.moveDir).toBe('approach')
  })

  it('ход retreat также не тратит бюджет атак/блоков', () => {
    const turn = normalizeTurn({ stance: 'defense4', blockZones: ['HEAD', 'CHEST', 'LEGS', 'RIGHT_ARM'], moveDir: 'retreat' })
    expect(turn.attackZones).toEqual([])
    expect(turn.blockZones).toEqual([])
    expect(turn.moveDir).toBe('retreat')
  })

  it('без moveDir стойка работает как прежде', () => {
    const turn = normalizeTurn({ stance: 'attack2', attackZones: ['HEAD', 'CHEST'] })
    expect(turn.attackZones).toEqual(['HEAD', 'CHEST'])
    expect(turn.moveDir).toBeUndefined()
  })
})

describe('выбор клетки движения (approach/retreat)', () => {
  it('approach сокращает дистанцию до противника на 1', () => {
    const me = fighter('me', 2, 1, 2)
    const foe = fighter('foe', 1, 7, 2)
    const before = gridDistance(me.position, foe.position)
    const cell = pickMoveCell(me, foe, 'approach', [me, foe])
    expect(cell).toEqual({ x: 2, y: 2 })
    expect(gridDistance(cell!, foe.position)).toBe(before - 1)
  })

  it('retreat увеличивает дистанцию до противника', () => {
    const me = fighter('me', 2, 4, 2)
    const foe = fighter('foe', 1, 7, 2)
    const before = gridDistance(me.position, foe.position)
    const cell = pickMoveCell(me, foe, 'retreat', [me, foe])
    expect(cell).toBeDefined()
    expect(gridDistance(cell!, foe.position)).toBeGreaterThan(before)
  })

  it('нельзя подойти вплотную на клетку, занятую противником', () => {
    const me = fighter('me', 2, 6, 2)
    const foe = fighter('foe', 1, 7, 2)
    // единственный шаг к врагу — {7,2}, но она занята → валидного хода нет
    const cell = pickMoveCell(me, foe, 'approach', [me, foe])
    expect(cell).toBeUndefined()
  })
})
