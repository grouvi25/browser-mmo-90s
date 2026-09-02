/**
 * Командный бой N×N: сбор состава, раунд на всех и итог по сторонам.
 *
 * Дуэльный резолвер написан на двух бойцов, поэтому команда идёт своим
 * проходом — тест следит, чтобы он считал урон, добивал сторону и
 * раздавал награду каждому, а не только первому попавшемуся.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BattleRedis } from '../../shared/db/redis'
import { BattleService } from '../../modules/battles/battles.service'
import { cleanDatabase, testPrisma, uid } from './helpers'

type LiveState = {
  roundNumber: number
  participants: Array<{
    participantId: string
    characterId: string | null
    side: number
    hpCurrent: number
    isAlive: boolean
    position: { x: number; y: number }
  }>
}

async function player(prefix: string, hp = 200) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'ATHLETE', hpCurrent: hp, hpMax: hp, battleLevel: 5 },
  })
  await testPrisma.characterStats.create({
    data: { characterId: character.id, str: 6, agi: 5, rea: 5, acc: 7, end: 5, luck: 5, agr: 5, auth: 5 },
  })
  return { user, character }
}

const FULL_BLOCK = ['HEAD', 'CHEST', 'LEFT_ARM', 'RIGHT_ARM'] as const

describe('командный бой', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  it('собирает состав 2×2 и разводит стороны по своим спавнам', async () => {
    const host = await player('host')
    const ally = await player('ally')
    const foe1 = await player('foe1')
    const foe2 = await player('foe2')

    const created = await BattleService.createTeamBattle(host.user.id, 2) as { battleId: string; perSide: number }
    expect(created.perSide).toBe(2)

    await BattleService.joinTeamBattle(ally.user.id, created.battleId, 1)
    await BattleService.joinTeamBattle(foe1.user.id, created.battleId, 2)
    await BattleService.joinTeamBattle(foe2.user.id, created.battleId, 2)

    const started = await BattleService.startTeamBattle(host.user.id, created.battleId) as { participants: number }
    expect(started.participants).toBe(4)

    const state = await BattleRedis.getState<LiveState>(created.battleId)
    expect(state!.participants).toHaveLength(4)
    expect(state!.participants.filter(p => p.side === 1)).toHaveLength(2)
    expect(state!.participants.filter(p => p.side === 2)).toHaveLength(2)

    // Спавны сторон не пересекаются и все клетки различны.
    const cells = state!.participants.map(p => `${p.position.x}:${p.position.y}`)
    expect(new Set(cells).size).toBe(4)
  })

  it('не пускает третьего в набранную сторону', async () => {
    const host = await player('host2')
    const ally = await player('ally2')
    const extra = await player('extra2')

    const created = await BattleService.createTeamBattle(host.user.id, 1) as { battleId: string }
    await BattleService.joinTeamBattle(ally.user.id, created.battleId, 2)
    await expect(BattleService.joinTeamBattle(extra.user.id, created.battleId, 2)).rejects.toThrow()
  })

  it('не стартует, пока вторая сторона пуста', async () => {
    const host = await player('lonely')
    const created = await BattleService.createTeamBattle(host.user.id, 2) as { battleId: string }
    await expect(BattleService.startTeamBattle(host.user.id, created.battleId)).rejects.toThrow()
  })

  it('считает раунд на всех: урон идёт по сторонам, а не по паре', async () => {
    const host = await player('atk1')
    const ally = await player('atk2')
    const foe1 = await player('def1')
    const foe2 = await player('def2')

    const created = await BattleService.createTeamBattle(host.user.id, 2) as { battleId: string }
    await BattleService.joinTeamBattle(ally.user.id, created.battleId, 1)
    await BattleService.joinTeamBattle(foe1.user.id, created.battleId, 2)
    await BattleService.joinTeamBattle(foe2.user.id, created.battleId, 2)
    await BattleService.startTeamBattle(host.user.id, created.battleId)

    const before = await BattleRedis.getState<LiveState>(created.battleId)
    // Сводим стороны вплотную, иначе первый раунд уйдёт на сближение.
    for (const part of before!.participants) {
      part.position = part.side === 1 ? { x: 4, y: part.position.y } : { x: 5, y: part.position.y }
    }
    await BattleRedis.setState(created.battleId, before)

    const attackers = [host, ally]
    const defenders = [foe1, foe2]
    for (const attacker of attackers) {
      await BattleService.submitAction(attacker.user.id, created.battleId, {
        action: 'attack', stance: 'attack2', attackZones: ['CHEST', 'HEAD'], blockZones: [],
      })
    }
    let last: unknown
    for (const defender of defenders) {
      last = await BattleService.submitAction(defender.user.id, created.battleId, {
        action: 'block', stance: 'defense4', attackZones: [], blockZones: [...FULL_BLOCK],
      })
    }

    const result = last as { battleOver?: boolean; roundNumber?: number; participants?: LiveState['participants'] }
    // Раунд посчитан на всех четверых.
    expect(result.participants?.length ?? 0).toBe(4)

    const turns = await testPrisma.battleTurn.findMany({ where: { battleId: created.battleId, action: 'ATTACK' } })
    expect(turns.length).toBeGreaterThan(0)
    // Бьют только нападающие, и только по чужой стороне.
    const attackerIds = attackers.map(a => a.character.id)
    const defenderIds = defenders.map(d => d.character.id)
    for (const turn of turns) {
      expect(attackerIds).toContain(turn.actorCharId)
      expect(defenderIds).toContain(turn.targetCharId)
    }
  })

  it('заканчивает бой, когда сторона легла, и начисляет опыт каждому', async () => {
    const strong = await player('strong', 400)
    const weak = await player('weak', 1)

    const created = await BattleService.createTeamBattle(strong.user.id, 1) as { battleId: string }
    await BattleService.joinTeamBattle(weak.user.id, created.battleId, 2)
    await BattleService.startTeamBattle(strong.user.id, created.battleId)

    const state = await BattleRedis.getState<LiveState>(created.battleId)
    for (const part of state!.participants) {
      part.position = part.side === 1 ? { x: 4, y: 4 } : { x: 5, y: 4 }
    }
    await BattleRedis.setState(created.battleId, state)

    // Размен идёт на живых бросках: уворот считается как `rng() >= hitChance`,
    // и оба удара по ногам могли пройти мимо — тогда защитник с 1 HP выживал
    // и бой не заканчивался. Тест про подсчёт итога, а не про меткость,
    // поэтому броски фиксируются: 0 не даёт увернуться ни одному удару.
    type TurnResult = { battleOver?: boolean; winnerSide?: number | null; rewards?: Record<string, { expGain: number }> }
    let result: TurnResult
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      await BattleService.submitAction(strong.user.id, created.battleId, {
        // Ноги защитник не закрывает: FULL_BLOCK — это голова, корпус и руки.
        // Ног теперь две отдельные зоны, поэтому бьём по обеим.
        action: 'attack', stance: 'attack2', attackZones: ['LEFT_LEG', 'RIGHT_LEG'], blockZones: [],
      })
      result = await BattleService.submitAction(weak.user.id, created.battleId, {
        action: 'block', stance: 'defense4', attackZones: [], blockZones: [...FULL_BLOCK],
      }) as TurnResult
    } finally {
      rng.mockRestore()
    }

    expect(result.battleOver).toBe(true)
    expect(result.winnerSide).toBe(1)
    // Награда посчитана обеим сторонам, а не только победителю.
    expect(Object.keys(result.rewards ?? {})).toHaveLength(2)

    const battle = await testPrisma.battle.findUniqueOrThrow({ where: { id: created.battleId } })
    expect(battle.status).toBe('FINISHED')
    expect(battle.winnerId).toBe(strong.character.id)

    // Состояние боя убрано из Redis.
    expect(await BattleRedis.getState(created.battleId)).toBeNull()
  })
})
