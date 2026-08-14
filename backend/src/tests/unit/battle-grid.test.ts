import { describe, expect, it } from 'vitest'
import {
  canAttackTarget,
  canMoveTo,
  gridDistance,
  hexNeighbours,
  hasLineOfSight,
  isAdjacentStep,
  isInsideGrid,
  resolveSimultaneousMoves,
  selectEnemyTarget,
  stepAway,
  stepToward,
  teamSpawnPositions,
  type PositionedParticipant,
} from '../../modules/battles/grid'

const fighter = (participantId: string, side: number, x: number, y: number): PositionedParticipant => ({
  participantId, side, isAlive: true, position: { x, y },
})

describe('battle grid movement', () => {
  it('uses only physically adjacent authored PSD cells', () => {
    const origin = { x: 1, y: 4 }
    const neighbours = hexNeighbours(origin)
    expect(neighbours.length).toBeGreaterThanOrEqual(2)
    expect(neighbours.length).toBeLessThanOrEqual(6)
    for (const cell of neighbours) expect(isAdjacentStep(origin, cell)).toBe(true)
    expect(isAdjacentStep(origin, origin)).toBe(false)
    expect(isAdjacentStep(origin, { x: 8, y: 8 })).toBe(false)
  })

  it('measures shortest paths over the authored cell graph', () => {
    const origin = { x: 1, y: 4 }
    for (const cell of hexNeighbours(origin)) expect(gridDistance(origin, cell)).toBe(1)
    const far = { x: 8, y: 8 }
    expect(gridDistance(origin, far)).toBeGreaterThan(1)
    expect(gridDistance(origin, far)).toBe(gridDistance(far, origin))
  })

  it('does not allow moving into an occupied painted cell', () => {
    const player = fighter('p1', 1, 1, 4)
    const [occupied, free] = hexNeighbours(player.position)
    const ally = fighter('p2', 1, occupied.x, occupied.y)
    expect(canMoveTo(player, occupied, [player, ally])).toBe(false)
    expect(canMoveTo(player, free, [player, ally])).toBe(true)
  })

  it('builds approach and retreat candidates from graph distance', () => {
    const from = { x: 1, y: 4 }, target = { x: 7, y: 4 }
    const current = gridDistance(from, target)
    const approach = stepToward(from, target)
    expect(approach.length).toBeGreaterThan(0)
    expect(approach.every(cell => gridDistance(cell, target) < current)).toBe(true)
    const retreat = stepAway(from, target)
    expect(retreat.length).toBeGreaterThan(0)
    expect(gridDistance(retreat[0], target)).toBeGreaterThanOrEqual(gridDistance(retreat.at(-1)!, target))
  })

  it('allows two fighters to swap adjacent cells simultaneously', () => {
    const first = fighter('p1', 1, 2, 2)
    const adjacent = hexNeighbours(first.position)[0]
    const second = fighter('p2', 2, adjacent.x, adjacent.y)
    const resolved = resolveSimultaneousMoves([first, second], [
      { participantId: 'p1', destination: adjacent },
      { participantId: 'p2', destination: first.position },
    ])
    expect(resolved.find(p => p.participantId === 'p1')?.position).toEqual(adjacent)
    expect(resolved.find(p => p.participantId === 'p2')?.position).toEqual(first.position)
  })

  it('rejects collisions and movement into a stationary occupied cell', () => {
    const destination = { x: 2, y: 2 }
    const sources = Array.from({ length: 9 }, (_, y) =>
      Array.from({ length: 9 }, (_, x) => ({ x, y }))).flat()
      .filter(source => hexNeighbours(source).some(cell => cell.x === destination.x && cell.y === destination.y))
    const [firstCell, secondCell] = sources
    const first = fighter('p1', 1, firstCell.x, firstCell.y)
    const second = fighter('p2', 2, secondCell.x, secondCell.y)
    const blocker = fighter('p3', 2, destination.x, destination.y)
    expect(() => resolveSimultaneousMoves([first, second], [
      { participantId: 'p1', destination },
      { participantId: 'p2', destination },
    ])).toThrow('Multiple fighters')
    expect(() => resolveSimultaneousMoves([first, blocker], [
      { participantId: 'p1', destination },
    ])).toThrow('occupied')
  })
})

describe('battle grid attacks and protection', () => {
  it('requires melee fighters to stand on adjacent painted cells', () => {
    const attacker = fighter('a', 1, 1, 4)
    const adjacent = hexNeighbours(attacker.position)[0]
    const target = fighter('t', 2, adjacent.x, adjacent.y)
    expect(canAttackTarget(attacker, target, [attacker, target], 1)).toBe(true)
    target.position = { x: 8, y: 8 }
    expect(canAttackTarget(attacker, target, [attacker, target], 1)).toBe(false)
  })

  it('lets a front fighter shield an ally from ranged fire', () => {
    const attacker = fighter('a', 1, 5, 4)
    const protector = fighter('p', 2, 5, 3)
    const target = fighter('t', 2, 7, 4)
    const all = [attacker, protector, target]
    expect(hasLineOfSight(attacker.position, target.position, all, 'a', 't')).toBe(false)
    expect(canAttackTarget(attacker, target, all, 5)).toBe(false)
    expect(canAttackTarget(attacker, protector, all, 5)).toBe(true)
  })
})


describe('battle grid teams and target selection', () => {
  it('places both teams in deterministic center-out spawn rows', () => {
    expect(teamSpawnPositions(1, 3)).toEqual([
      { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 1 },
    ])
    expect(teamSpawnPositions(2, 3)).toEqual([
      { x: 7, y: 6 }, { x: 6, y: 6 }, { x: 7, y: 5 },
    ])
    expect(hexNeighbours(teamSpawnPositions(1, 1)[0])).toHaveLength(6)
    expect(hexNeighbours(teamSpawnPositions(2, 1)[0])).toHaveLength(6)
  })

  it('supports all nine authored rows', () => {
    expect(teamSpawnPositions(1, 9)).toHaveLength(9)
    expect(new Set(teamSpawnPositions(1, 9).map(position => `${position.x}:${position.y}`)).size).toBe(9)
    expect(isInsideGrid({ x: 8, y: 8 })).toBe(true)
    expect(isInsideGrid({ x: 8, y: 9 })).toBe(false)
  })

  it('requires an explicit living enemy target when several enemies exist', () => {
    const actor = fighter('a', 1, 1, 2)
    const ally = fighter('ally', 1, 1, 1)
    const front = fighter('front', 2, 4, 2)
    const rear = fighter('rear', 2, 7, 2)
    const all = [actor, ally, front, rear]

    expect(() => selectEnemyTarget(actor, all)).toThrow('Invalid battle target')
    expect(selectEnemyTarget(actor, all, 'front')).toBe(front)
    expect(() => selectEnemyTarget(actor, all, 'ally')).toThrow('Invalid battle target')
    rear.isAlive = false
    expect(() => selectEnemyTarget(actor, all, 'rear')).toThrow('Invalid battle target')
  })

  it('keeps the one-enemy duel contract backward compatible', () => {
    const actor = fighter('a', 1, 1, 2)
    const target = fighter('t', 2, 7, 2)
    expect(selectEnemyTarget(actor, [actor, target])).toBe(target)
  })
})
