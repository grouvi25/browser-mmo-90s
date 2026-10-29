// Помощник и собака на поле (правка заказчика 28.10): клетка вызова,
// ход как у бота, урон по фигуре.
import { describe, expect, it } from 'vitest'
import {
  companionCells, companionTurn, damageCompanion, dogHpMax, parseCompanionId, summonCell,
  type CompanionOwner,
} from '../../modules/battles/companions'
import { gridDistance, hexNeighbours, type PositionedParticipant } from '../../modules/battles/grid'

const at = (participantId: string, x: number, y: number, side = 1): PositionedParticipant =>
  ({ participantId, side, isAlive: true, position: { x, y } })

function owner(over: Partial<CompanionOwner> = {}): CompanionOwner {
  return {
    participantId: 'p1', side: 1, isAlive: true, position: { x: 2, y: 5 },
    helper: { id: 'h1', name: 'Сеня', level: 3, tactic: 'ATTACK', hp: 66, hpMax: 66, alive: true, damageDealt: 0 },
    dog: { id: 'd1', name: 'Рекс', level: 2, hp: 50, hpMax: 50, alive: true, damageDealt: 0, stats: { str: 2, agi: 0, rea: 0, acc: 0, end: 2, luck: 0 } },
    ...over,
  }
}

describe('клетка вызова', () => {
  it('справа от хозяина; занято — следующая справа', () => {
    expect(summonCell({ x: 2, y: 5 }, [at('p1', 2, 5)])).toEqual({ x: 3, y: 5 })
    expect(summonCell({ x: 2, y: 5 }, [at('p1', 2, 5), at('x', 3, 5)])).toEqual({ x: 4, y: 5 })
  })

  it('весь ряд справа занят — ряды сверху вниз', () => {
    const board = [at('p1', 2, 5), ...Array.from({ length: 7 }, (_, i) => at(`b${i}`, 3 + i, 5))]
    expect(summonCell({ x: 2, y: 5 }, board)).toEqual({ x: 3, y: 0 })
  })
})

describe('фигура на поле', () => {
  it('невызванная не стоит на доске и не ходит', () => {
    const o = owner()
    expect(companionCells([o])).toEqual([])
    expect(companionTurn({ owner: o, kind: 'helper', enemies: [{ id: 'e', side: 2, position: { x: 3, y: 5 } }], board: () => [], strike: () => undefined })).toBeNull()
  })

  it('враг рядом — бьёт, далеко — шагает к нему', () => {
    const o = owner()
    o.dog!.summoned = true
    o.dog!.position = { x: 3, y: 5 }
    const near = hexNeighbours({ x: 3, y: 5 })[0]
    let hits = 0
    const attack = companionTurn({
      owner: o, kind: 'dog', enemies: [{ id: 'e', side: 2, position: near }],
      board: () => [at('p1', 2, 5), ...companionCells([o]), at('e', near.x, near.y, 2)],
      strike: () => { hits++ }, rnd: () => 0,
    })
    expect(attack).toMatchObject({ type: 'attack', targetId: 'e' })
    expect(hits).toBe(1)

    const far = { x: 8, y: 5 }
    const before = gridDistance(o.dog!.position!, far)
    const move = companionTurn({
      owner: o, kind: 'dog', enemies: [{ id: 'e', side: 2, position: far }],
      board: () => [at('p1', 2, 5), ...companionCells([o]), at('e', far.x, far.y, 2)],
      strike: () => undefined,
    })
    expect(move).toMatchObject({ type: 'move' })
    expect(gridDistance(o.dog!.position!, far)).toBeLessThan(before)
  })

  it('урон по фигуре: на нуле выбывает и освобождает клетку', () => {
    const o = owner()
    o.helper!.summoned = true
    o.helper!.position = { x: 3, y: 5 }
    damageCompanion(o.helper!, 100)
    expect(o.helper!.alive).toBe(false)
    expect(companionCells([o])).toEqual([])
  })

  it('здоровье собаки растёт от уровня и выносливости; адрес фигуры читается', () => {
    expect(dogHpMax(3, 2)).toBeGreaterThan(dogHpMax(1, 0))
    expect(parseCompanionId('dog:abc')).toEqual({ kind: 'dog', ownerParticipantId: 'abc' })
    expect(parseCompanionId('abc')).toBeNull()
  })
})
