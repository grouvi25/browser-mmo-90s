/**
 * Просмотр чужого боя (заказчик 4.11). Зритель видит поле и здоровье, но не
 * выбранный бойцом и ещё не сыгранный ход: иначе второй аккаунт подсказывал бы
 * сопернику, куда бить.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { BattleRedis, disconnectRedis, getRedis } from '../../shared/db/redis'
import { storeSession } from '../../shared/security/jwt'
import { cleanDatabase, testPrisma, uid } from './helpers'

let app: FastifyInstance
beforeAll(async () => { await testPrisma.$connect(); app = await buildApp(); await app.ready(); await getRedis().ping() })
beforeEach(async () => cleanDatabase())
afterAll(async () => { await app.close(); await testPrisma.$disconnect(); await disconnectRedis() })

async function player(prefix: string) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'STREET', hpCurrent: 80, hpMax: 80 } })
  const jti = randomUUID()
  await storeSession(jti, user.id)
  return { character, headers: { authorization: `Bearer ${app.jwt.sign({ sub: user.id, jti })}` } }
}

async function duel(status: 'ACTIVE' | 'FINISHED' | 'WAITING_PLAYERS') {
  const [one, two] = [await player('one'), await player('two')]
  const battle = await testPrisma.battle.create({ data: { type: 'PVP_DUEL', status, startedAt: new Date() } })
  const first = await testPrisma.battleParticipant.create({ data: { battleId: battle.id, characterId: one.character.id, side: 1, hpMax: 80, hpCurrent: 70 } })
  const second = await testPrisma.battleParticipant.create({ data: { battleId: battle.id, characterId: two.character.id, side: 2, hpMax: 80, hpCurrent: 60 } })
  return { battle, one, two, first, second }
}

const live = (battleId: string, firstId: string, secondId: string) => ({
  battleId, type: 'PVP_DUEL', roundNumber: 3, status: 'active', roundDeadline: Date.now() + 30_000,
  participants: [
    {
      participantId: firstId, side: 1, hpCurrent: 70, hpMax: 80, isAlive: true, isSurrendered: false, hasActedThisRound: true,
      pendingAction: 'attack', pendingTurn: { stance: 'defense4', attackZones: ['HEAD'], blockZones: ['CHEST'] },
      pocketItemIds: ['secret-pocket'], leftWeaponInstanceId: 'secret-weapon', wounds: { HEAD: 2 },
      damageDealt: 20, healedTotal: 0, damageReceived: 10, hitsTaken: 1, hitsLanded: 2, skippedTurns: 0, position: { x: 2, y: 3 },
    },
    {
      participantId: secondId, side: 2, hpCurrent: 60, hpMax: 80, isAlive: true, isSurrendered: false, hasActedThisRound: false,
      damageDealt: 10, healedTotal: 0, damageReceived: 20, hitsTaken: 2, hitsLanded: 1, skippedTurns: 0, position: { x: 5, y: 3 },
    },
  ],
})

describe('Просмотр боя', () => {
  it('зритель видит поле и здоровье, но не выбранный ход и карманы', async () => {
    const { battle, first, second } = await duel('ACTIVE')
    await BattleRedis.setState(battle.id, live(battle.id, first.id, second.id))
    const viewer = await player('view')
    const res = await app.inject({ method: 'GET', url: `/api/battles/${battle.id}/watch`, headers: viewer.headers })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.isMine).toBe(false)
    expect(body.live.roundNumber).toBe(3)
    expect(body.live.participants[0]).toMatchObject({ hpCurrent: 70, position: { x: 2, y: 3 } })
    expect(body.fighters).toHaveLength(2)
    for (const secret of ['pendingTurn', 'pendingAction', 'attackZones', 'blockZones', 'secret-pocket', 'secret-weapon', 'characterId', 'wounds']) {
      expect(res.body).not.toContain(secret)
    }
  })

  it('обычный запрос боя чужому по-прежнему закрыт', async () => {
    const { battle } = await duel('ACTIVE')
    const viewer = await player('view')
    const res = await app.inject({ method: 'GET', url: `/api/battles/${battle.id}`, headers: viewer.headers })
    expect(res.statusCode).toBe(403)
  })

  it('участник узнаёт, что бой его; заявку ещё не посмотреть', async () => {
    const running = await duel('ACTIVE')
    await BattleRedis.setState(running.battle.id, live(running.battle.id, running.first.id, running.second.id))
    const mine = await app.inject({ method: 'GET', url: `/api/battles/${running.battle.id}/watch`, headers: running.one.headers })
    expect(mine.json().isMine).toBe(true)

    const waiting = await duel('WAITING_PLAYERS')
    const res = await app.inject({ method: 'GET', url: `/api/battles/${waiting.battle.id}/watch`, headers: waiting.one.headers })
    expect(res.statusCode).toBe(409)
  })

  it('законченный бой показывает победителя без живого состояния', async () => {
    const { battle, first } = await duel('FINISHED')
    await testPrisma.battle.update({ where: { id: battle.id }, data: { winnerParticipantId: first.id, finishedAt: new Date() } })
    const viewer = await player('view')
    const body = (await app.inject({ method: 'GET', url: `/api/battles/${battle.id}/watch`, headers: viewer.headers })).json()
    expect(body.live).toBeNull()
    expect(body.battle.winnerSide).toBe(1)
  })
})
