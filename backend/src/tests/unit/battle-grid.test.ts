import { describe, expect, it } from 'vitest'
import {
  canAttackTarget,
  canMoveTo,
  gridDistance,
  hasLineOfSight,
  isAdjacentStep,
  stepAway,
  stepToward,
  type PositionedParticipant,
} from '../../modules/battles/grid'

const fighter = (participantId: string, side: number, x: number, y: number): PositionedParticipant => ({
  participantId, side, isAlive: true, position: { x, y },
})

describe('battle grid movement', () => {
  it('allows one orthogonal cell and rejects diagonal/jumps', () => {
    expect(isAdjacentStep({ x: 1, y: 2 }, { x: 2, y: 2 })).toBe(true)
    expect(isAdjacentStep({ x: 1, y: 2 }, { x: 2, y: 3 })).toBe(false)
    expect(isAdjacentStep({ x: 1, y: 2 }, { x: 3, y: 2 })).toBe(false)
  })

  it('does not allow moving into an occupied cell', () => {
    const player = fighter('p1', 1, 1, 2)
    const ally = fighter('p2', 1, 2, 2)
    expect(canMoveTo(player, { x: 2, y: 2 }, [player, ally])).toBe(false)
    expect(canMoveTo(player, { x: 1, y: 1 }, [player, ally])).toBe(true)
  })

  it('builds useful approach and retreat candidates', () => {
    expect(stepToward({ x: 1, y: 2 }, { x: 5, y: 3 })).toEqual([
      { x: 2, y: 2 }, { x: 1, y: 3 },
    ])
    expect(gridDistance(stepAway({ x: 4, y: 2 }, { x: 3, y: 2 })[0], { x: 3, y: 2 })).toBe(2)
  })
})

describe('battle grid attacks and protection', () => {
  it('requires melee fighters to stand next to the target', () => {
    const attacker = fighter('a', 1, 1, 2)
    const target = fighter('t', 2, 2, 2)
    expect(canAttackTarget(attacker, target, [attacker, target], 1)).toBe(true)
    target.position = { x: 3, y: 2 }
    expect(canAttackTarget(attacker, target, [attacker, target], 1)).toBe(false)
  })

  it('lets a front fighter shield an ally from ranged fire', () => {
    const attacker = fighter('a', 1, 1, 2)
    const protector = fighter('p', 2, 4, 2)
    const target = fighter('t', 2, 7, 2)
    const all = [attacker, protector, target]
    expect(hasLineOfSight(attacker.position, target.position, all, 'a', 't')).toBe(false)
    expect(canAttackTarget(attacker, target, all, 8)).toBe(false)
    expect(canAttackTarget(attacker, protector, all, 8)).toBe(true)
  })
})
