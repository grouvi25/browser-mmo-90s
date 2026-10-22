import { describe, expect, it } from 'vitest'
import { DUEL_ARENA, DUEL_OBSTACLES, arenaBlockers, canAttackTarget, canMoveTo, hexNeighbours, stepTowardOrAround, type PositionedParticipant } from '../../modules/battles/grid'

const fighter = (id: string, side: number, x: number, y: number): PositionedParticipant => ({ participantId: id, side, isAlive: true, position: { x, y } })

describe('Дуэль: полоса 3×8 и бочки', () => {
  const blockers = arenaBlockers(DUEL_ARENA, DUEL_OBSTACLES)

  it('за полосу и на бочку не шагнуть', () => {
    const me = fighter('me', 1, 1, 4)
    const board = [...blockers, me]
    expect(canMoveTo(me, { x: 1, y: 3 }, board)).toBe(false)
    expect(canMoveTo(me, { x: 0, y: 4 }, board)).toBe(false)
    expect(canMoveTo(me, { x: 2, y: 4 }, board)).toBe(true)
    const nearBarrel = fighter('me', 1, 4, 4)
    expect(canMoveTo(nearBarrel, { x: 5, y: 4 }, [...blockers, nearBarrel])).toBe(false)
  })

  it('бочка закрывает от выстрела, край полосы — нет', () => {
    const shooter = fighter('s', 2, 7, 4)
    const hidden = fighter('h', 1, 3, 4)
    expect(canAttackTarget(shooter, hidden, [...blockers, shooter, hidden], 5)).toBe(false)
    // Ряд 5 свободен от бочек: выстрел вдоль полосы проходит.
    const across = fighter('s2', 2, 7, 5)
    const open = fighter('o', 1, 3, 5)
    expect(canAttackTarget(across, open, [...blockers, across, open], 5)).toBe(true)
  })

  it('бот обходит бочку, если прямые клетки заняты', () => {
    const from = { x: 4, y: 4 }
    const route = stepTowardOrAround(from, { x: 8, y: 4 })
    expect(route.length).toBe(hexNeighbours(from).length)
    const bot = fighter('b', 2, 4, 4)
    expect(route.some(cell => canMoveTo(bot, cell, [...blockers, bot]))).toBe(true)
  })
})
