/**
 * Дима 10.11: «бой не заканчивался, пока всех не перебьют» — вызванные
 * помощник и собака держат сторону, пока живы, даже если хозяина выбили.
 */
import { describe, expect, it } from 'vitest'
import { teamOutcome, type LiveTeamState } from '../../modules/battles/team-battle'

const fighter = (side: number, alive: boolean, extra: Record<string, unknown> = {}) => ({
  participantId: `p${side}${alive ? 'a' : 'd'}${Math.random()}`, side, isAlive: alive, isSurrendered: false,
  position: { x: side, y: 4 }, hpCurrent: alive ? 50 : 0, hpMax: 50, ...extra,
})
const dog = (alive: boolean, summoned = true) => ({ id: 'd', name: 'Пёс', level: 1, hp: alive ? 10 : 0, hpMax: 10, alive, damageDealt: 0, summoned, position: { x: 3, y: 5 } })
const state = (participants: unknown[]) => ({ participants, roundNumber: 3 }) as unknown as LiveTeamState

describe('конец группового боя с помощниками и собаками', () => {
  it('люди одной стороны выбиты, но её собака на поле — бой идёт', () => {
    expect(teamOutcome(state([fighter(1, false, { dog: dog(true) }), fighter(2, true)]))).toEqual({ over: false, winnerSide: null })
  })
  it('собаку добили — бой окончен, победила другая сторона', () => {
    expect(teamOutcome(state([fighter(1, false, { dog: dog(false) }), fighter(2, true)]))).toEqual({ over: true, winnerSide: 2 })
  })
  it('невызванная собака сторону не держит', () => {
    expect(teamOutcome(state([fighter(1, false, { dog: dog(true, false) }), fighter(2, true)]))).toEqual({ over: true, winnerSide: 2 })
  })
})
