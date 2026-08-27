/**
 * Шаг в PvP применяется сразу, а не по закрытию раунда.
 *
 * До этого раунд считался только когда походили все, и перемещение
 * противника становилось видно уже вместе с разменом ударов — то есть
 * тактического смысла в шаге не оставалось.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BattleRedis } from '../../shared/db/redis'
import { BattleService } from '../../modules/battles/battles.service'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function player(prefix: string) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'ATHLETE', hpCurrent: 200, hpMax: 200, battleLevel: 3 },
  })
  await testPrisma.characterStats.create({
    data: { characterId: character.id, str: 5, agi: 5, rea: 5, acc: 5, end: 5, luck: 5, agr: 5, auth: 5 },
  })
  return { user, character }
}

/** Соседняя свободная клетка для бойца — по тем же правилам, что и сервер. */
function stepFrom(position: { x: number; y: number }, taken: Array<{ x: number; y: number }>) {
  const deltas = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  for (const [dx, dy] of deltas) {
    const next = { x: position.x + dx, y: position.y + dy }
    if (next.x < 0 || next.y < 0 || next.x > 9 || next.y > 9) continue
    if (taken.some(t => t.x === next.x && t.y === next.y)) continue
    return next
  }
  throw new Error('нет свободной соседней клетки')
}


/** Дуэль поднимается матчмейкингом: первый открывает, второй принимает. */
async function duel(hostUserId: string, guestUserId: string): Promise<string> {
  const open = await BattleService.createPvpDuel(hostUserId) as { battleId: string }
  await BattleService.acceptPvpDuel(guestUserId, open.battleId)
  return open.battleId
}

describe('PvP: немедленный шаг', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  it('двигает бойца сразу, пишет ход в журнал и не ждёт противника', async () => {
    const a = await player('mover')
    const b = await player('waiter')

    const battleId = await duel(a.user.id, b.user.id)
    const before = await BattleRedis.getState<{
      participants: Array<{ characterId: string | null; position: { x: number; y: number } }>
      distance: number
      roundNumber: number
    }>(battleId)
    expect(before).toBeTruthy()

    const me = before!.participants.find(p => p.characterId === a.character.id)!
    const foe = before!.participants.find(p => p.characterId === b.character.id)!
    const destination = stepFrom(me.position, [foe.position])

    const result = await BattleService.submitAction(a.user.id, battleId, {
      action: 'move',
      stance: 'defense4',
      attackZones: [],
      blockZones: ['HEAD', 'CHEST', 'LEFT_ARM', 'RIGHT_ARM'],
      moveTo: destination,
    }) as { waiting?: boolean; moved?: boolean; position?: { x: number; y: number } }

    // Раунд не закрыт — противник ещё не ходил.
    expect(result.waiting).toBe(true)
    // Но фигура уже стоит на новой клетке.
    expect(result.moved).toBe(true)
    expect(result.position).toEqual(destination)

    const after = await BattleRedis.getState<{
      participants: Array<{ characterId: string | null; position: { x: number; y: number } }>
    }>(battleId)
    const movedPart = after!.participants.find(p => p.characterId === a.character.id)!
    expect(movedPart.position).toEqual(destination)

    const logged = await testPrisma.battleTurn.findMany({
      where: { battleId, actorCharId: a.character.id, action: 'MOVE' },
    })
    expect(logged).toHaveLength(1)
    expect({ x: logged[0].toX, y: logged[0].toY }).toEqual(destination)
  })

  it('не двигает дважды: закрытие раунда оставляет бойца там, куда он шагнул', async () => {
    const a = await player('mover2')
    const b = await player('foe2')

    const battleId = await duel(a.user.id, b.user.id)
    const before = await BattleRedis.getState<{
      participants: Array<{ characterId: string | null; position: { x: number; y: number } }>
    }>(battleId)
    const me = before!.participants.find(p => p.characterId === a.character.id)!
    const foe = before!.participants.find(p => p.characterId === b.character.id)!
    const destination = stepFrom(me.position, [foe.position])

    await BattleService.submitAction(a.user.id, battleId, {
      action: 'move', stance: 'defense4', attackZones: [],
      blockZones: ['HEAD', 'CHEST', 'LEFT_ARM', 'RIGHT_ARM'], moveTo: destination,
    })
    // Второй игрок только защищается — раунд закрывается.
    await BattleService.submitAction(b.user.id, battleId, {
      action: 'block', stance: 'defense4', attackZones: [],
      blockZones: ['HEAD', 'CHEST', 'LEFT_ARM', 'RIGHT_ARM'],
    })

    const after = await BattleRedis.getState<{
      participants: Array<{ characterId: string | null; position: { x: number; y: number } }>
    }>(battleId)
    const movedPart = after!.participants.find(p => p.characterId === a.character.id)!
    expect(movedPart.position).toEqual(destination)

    const moves = await testPrisma.battleTurn.findMany({
      where: { battleId, actorCharId: a.character.id, action: 'MOVE' },
    })
    expect(moves).toHaveLength(1)
  })

  it('шаг отменяет удар, поэтому немедленное применение не трогает размен', async () => {
    const a = await player('striker')
    const b = await player('foe3')

    const battleId = await duel(a.user.id, b.user.id)
    const before = await BattleRedis.getState<{
      participants: Array<{ characterId: string | null; position: { x: number; y: number } }>
    }>(battleId)
    const me = before!.participants.find(p => p.characterId === a.character.id)!
    const foe = before!.participants.find(p => p.characterId === b.character.id)!
    const destination = stepFrom(me.position, [foe.position])

    // Просим шаг И удар одновременно. По правилам зон бюджет атак при
    // перемещении обнуляется, так что удара не будет в любом случае —
    // именно поэтому шаг можно применять сразу, не ломая одновременный
    // размен: ходивший в этом раунде всё равно не бьёт.
    await BattleService.submitAction(a.user.id, battleId, {
      action: 'attack', stance: 'attack2',
      attackZones: ['HEAD', 'CHEST'], blockZones: [],
      moveTo: destination,
    })
    await BattleService.submitAction(b.user.id, battleId, {
      action: 'block', stance: 'defense4', attackZones: [],
      blockZones: ['HEAD', 'CHEST', 'LEFT_ARM', 'RIGHT_ARM'],
    })

    // Противник не получил ни одного удара от шагнувшего.
    const strikes = await testPrisma.battleTurn.findMany({
      where: { battleId, actorCharId: a.character.id, action: 'ATTACK' },
    })
    expect(strikes).toHaveLength(0)

    const after = await BattleRedis.getState<{
      participants: Array<{ characterId: string | null; position: { x: number; y: number }; hpCurrent: number }>
    }>(battleId)
    const defender = after!.participants.find(p => p.characterId === b.character.id)!
    expect(defender.hpCurrent).toBe(200)
    const mover = after!.participants.find(p => p.characterId === a.character.id)!
    expect(mover.position).toEqual(destination)
  })
})
