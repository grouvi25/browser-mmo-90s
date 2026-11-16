import { describe, expect, it } from 'vitest'
import { timedOutCharacterIds } from '../../modules/battles/battle-timeout'
import { normalizeTurn } from '../../modules/battles/zones'
import type { LiveBattleState, LiveParticipant } from '../../modules/battles/battles.service'

const participant = (
  participantId: string,
  characterId: string | undefined,
  side: number,
  overrides: Partial<LiveParticipant> = {},
): LiveParticipant => ({
  participantId,
  characterId,
  hpCurrent: 100,
  hpMax: 100,
  side,
  isAlive: true,
  isSurrendered: false,
  hasActedThisRound: false,
  damageDealt: 0,
  damageReceived: 0,
  hitsTaken: 0,
  hitsLanded: 0,
  skippedTurns: 0,
  position: { x: side === 1 ? 1 : 7, y: 2 },
  ...overrides,
})

const state = (deadline: number): LiveBattleState => ({
  battleId: 'battle',
  type: 'PVP_TEAM',
  roundNumber: 3,
  status: 'active',
  roundDeadline: deadline,
  participants: [
    participant('p1', 'c1', 1),
    participant('p2', 'c2', 1),
    participant('p3', 'c3', 2, { hasActedThisRound: true }),
    participant('p4', 'c4', 2, { isAlive: false }),
    { ...participant('bot', undefined, 2), botId: 'bot-1' },
  ],
})

describe('battle timeout team handling', () => {
  it('returns every living character that still owes a turn', () => {
    expect(timedOutCharacterIds(state(1_000), 1_001)).toEqual(['c1', 'c2'])
  })

  it('does nothing before the deadline or outside active state', () => {
    expect(timedOutCharacterIds(state(2_000), 1_999)).toEqual([])
    const finishing = state(1_000)
    finishing.status = 'finishing'
    expect(timedOutCharacterIds(finishing, 2_000)).toEqual([])
  })

  // Дима 15.11: второй пропуск — замёрз до конца боя, раунд его не ждёт.
  it('frozen fighter is played by the timer at once, before the deadline', () => {
    const frozen = state(2_000)
    frozen.participants[0].frozen = true
    expect(timedOutCharacterIds(frozen, 1_000)).toEqual(['c1'])
  })

  it('missed turn stands still: no hits and no blocks', () => {
    const turn = normalizeTurn({ stance: 'defense4', idle: 'skip' })
    expect(turn.attackZones).toEqual([])
    expect(turn.blockZones).toEqual([])
    expect(turn.idle).toBe('skip')
  })
})
