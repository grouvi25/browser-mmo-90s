/**
 * Журнал боя (правка заказчика 20.10.2026): сохраняется в базе и листается
 * по 10 строк; строки собираются из ходов с именами бойцов.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { getRedis, disconnectRedis } from '../../shared/db/redis'
import { BattleJournal, describeTurn } from '../../modules/battles/battle-journal'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function fighter(prefix: string) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({ data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'STREET', hpCurrent: 80, hpMax: 80 } })
}

async function finishedBattle(turns: number) {
  const hero = await fighter('hero')
  const bot = await testPrisma.bot.create({
    data: { code: uid('bandit'), name: 'Бандит', hpMax: 60, stats: {}, equipment: {} },
  })
  const battle = await testPrisma.battle.create({
    data: { type: 'PVE_BOT', status: 'FINISHED', roundCount: turns, startedAt: new Date(Date.now() - 600_000), finishedAt: new Date() },
  })
  const heroSide = await testPrisma.battleParticipant.create({ data: { battleId: battle.id, characterId: hero.id, side: 1, hpMax: 80, hpCurrent: 50 } })
  await testPrisma.battleParticipant.create({ data: { battleId: battle.id, botId: bot.id, side: 2, hpMax: 60, hpCurrent: 0, isAlive: false } })
  await testPrisma.battle.update({ where: { id: battle.id }, data: { winnerParticipantId: heroSide.id } })
  const base = Date.now() - 300_000
  await testPrisma.battleTurn.createMany({
    data: Array.from({ length: turns }, (_, i) => ({
      battleId: battle.id, roundNumber: i + 1, actorCharId: hero.id, targetBotId: bot.id,
      action: 'ATTACK' as const, zone: 'CHEST' as const, hit: true, finalDamage: 5, rawDamage: 5,
      targetHpBefore: 60 - i * 5, targetHpAfter: 55 - i * 5, createdAt: new Date(base + i * 1000),
    })),
  })
  return { hero, bot, battle }
}

describe('журнал боя', () => {
  let app: FastifyInstance
  beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping(); app = await buildApp(); await app.ready() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })
  afterAll(async () => { await app.close(); await testPrisma.$disconnect(); await disconnectRedis() })

  it('листается по 10 строк, новые сверху, с именами и итогом боя', async () => {
    const { hero, battle } = await finishedBattle(23)

    const first = await BattleJournal.page(battle.id, 1)
    expect(first).toMatchObject({ page: 1, pages: 3, total: 23 })
    expect(first.items).toHaveLength(10)
    expect(first.items.map(l => l.round)).toEqual([23, 22, 21, 20, 19, 18, 17, 16, 15, 14])
    expect(first.items[0]).toMatchObject({ actor: hero.nickname, target: 'Бандит', side: 1, kind: 'hit', text: 'удар в корпус, −5 HP' })
    expect(first.battle).toMatchObject({ status: 'FINISHED', winner: hero.nickname, rounds: 23 })

    const last = await BattleJournal.page(battle.id, 3)
    expect(last.items.map(l => l.round)).toEqual([3, 2, 1])
    // Номер за пределами — последняя страница.
    expect((await BattleJournal.page(battle.id, 50)).page).toBe(3)
  })

  it('доступен по HTTP после боя и отвечает 404 на чужой номер', async () => {
    const { battle } = await finishedBattle(4)
    const login = uid('reader')
    const password = 'local_test_pw_123'
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { acceptPolicy: true, login, email: `${login}@test.local`, password } })
    const { token } = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login, password } })).json<{ token: string }>()

    const res = await app.inject({ method: 'GET', url: `/api/battles/${battle.id}/journal?page=1`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ total: number }>().total).toBe(4)

    const missing = await app.inject({ method: 'GET', url: '/api/battles/00000000-0000-4000-8000-000000000000/journal', headers: { authorization: `Bearer ${token}` } })
    expect(missing.statusCode).toBe(404)
    const bad = await app.inject({ method: 'GET', url: '/api/battles/not-a-uuid/journal', headers: { authorization: `Bearer ${token}` } })
    expect(bad.statusCode).toBe(422)
  })

  it('пишет зоны в винительном падеже и различает уворот, блок, крит и пробитие', () => {
    const base = { action: 'ATTACK' as const, sourceHand: null, hit: false, dodge: false, block: false, crit: false, blockPierced: false, finalDamage: 0 }
    expect(describeTurn({ ...base, zone: 'LEFT_ARM', dodge: true })).toEqual({ kind: 'dodge', text: 'удар в левую руку — уворот' })
    expect(describeTurn({ ...base, zone: 'HEAD', block: true, sourceHand: 'RIGHT_HAND' })).toEqual({ kind: 'block', text: 'удар правой в голову — блок' })
    expect(describeTurn({ ...base, zone: 'RIGHT_LEG', hit: true, crit: true, finalDamage: 12 })).toEqual({ kind: 'crit', text: 'крит в правую ногу, −12 HP' })
    expect(describeTurn({ ...base, zone: 'CHEST', hit: true, blockPierced: true, finalDamage: 7 })).toEqual({ kind: 'pierce', text: 'пробил блок в корпус, −7 HP' })
    expect(describeTurn({ ...base, action: 'MOVE', zone: null })).toEqual({ kind: 'move', text: 'делает шаг' })
  })
})
