/**
 * Заявки на бой — правка заказчика (октябрь 2026), как в «Королях»:
 * создание не бросает в бой, заявка висит в общем списке с таймером,
 * к ней присоединяются, а открывает бой воркер, когда время вышло.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApplicationsService, runBattleApplications } from '../../modules/battles/applications.service'
import { BattleRedis, disconnectRedis } from '../../shared/db/redis'
import { cleanDatabase, testPrisma, uid } from './helpers'

describe('заявки на бой', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => {
    await testPrisma.$disconnect()
    await disconnectRedis()
  })

  async function fighter(prefix: string, battleLevel = 10) {
    const login = uid(prefix)
    const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
    const character = await testPrisma.character.create({
      data: { userId: user.id, nickname: login, archetype: 'STREET', hpCurrent: 100, hpMax: 100, money: 1_000, battleLevel, status: 'ACTIVE' },
    })
    await testPrisma.characterStats.create({ data: { characterId: character.id } })
    return { user, character }
  }
  const statusOf = async (id: string) =>
    (await testPrisma.character.findUniqueOrThrow({ where: { id }, select: { status: true } })).status
  const battleOf = (id: string) => testPrisma.battle.findUniqueOrThrow({ where: { id }, include: { participants: true } })
  /** Перевести часы заявки в прошлое — как будто таймер истёк. */
  const expire = (id: string) => testPrisma.battle.update({ where: { id }, data: { startsAt: new Date(Date.now() - 1000) } })

  it('создание не бросает в бой: заявка ждёт в списке, создатель свободен', async () => {
    const a = await fighter('ap-a')
    const before = Date.now()
    const made = await ApplicationsService.create(a.user.id, { kind: 'DUEL', delayMinutes: 5 })
    expect(made.status).toBe('WAITING_PLAYERS')
    expect(new Date(made.startsAt!).getTime() - before).toBeGreaterThanOrEqual(5 * 60_000 - 1000)
    expect(await statusOf(a.character.id)).toBe('ACTIVE')
    expect(await BattleRedis.getState(made.battleId)).toBeNull()

    const list = await ApplicationsService.list(a.user.id)
    const row = list.applications.find(item => item.battleId === made.battleId)
    expect(row).toMatchObject({ kind: 'DUEL', isMine: true, isCreator: true })
    expect((await ApplicationsService.current(a.user.id)).application?.battleId).toBe(made.battleId)
  })

  it('дуэль стартует по таймеру, а до того в бой не открывается', async () => {
    const a = await fighter('du-a')
    const b = await fighter('du-b')
    const made = await ApplicationsService.create(a.user.id, { kind: 'DUEL', delayMinutes: 1 })
    await ApplicationsService.join(b.user.id, made.battleId)

    // Время не пришло — воркер заявку не трогает.
    await runBattleApplications()
    expect((await battleOf(made.battleId)).status).toBe('WAITING_PLAYERS')

    await expire(made.battleId)
    await runBattleApplications()
    const battle = await battleOf(made.battleId)
    expect(battle.status).toBe('ACTIVE')
    expect(await statusOf(a.character.id)).toBe('IN_BATTLE')
    expect(await statusOf(b.character.id)).toBe('IN_BATTLE')
    const live = await BattleRedis.getState<{ type: string; participants: unknown[] }>(made.battleId)
    expect(live).toMatchObject({ type: 'PVP_DUEL' })
    expect(live!.participants).toHaveLength(2)
    expect((await ApplicationsService.current(b.user.id)).battleId).toBe(made.battleId)
  })

  it('без соперника к старту заявка снимается и никого не держит', async () => {
    const a = await fighter('lone')
    const made = await ApplicationsService.create(a.user.id, { kind: 'GROUP', teamSize: 2, delayMinutes: 1 })
    await expire(made.battleId)
    await runBattleApplications()
    expect((await battleOf(made.battleId)).status).toBe('CANCELLED')
    expect(await statusOf(a.character.id)).toBe('ACTIVE')
  })

  it('групповой бой: стороны набираются до лимита, занятый к старту выпадает', async () => {
    const a1 = await fighter('g-a1')
    const a2 = await fighter('g-a2')
    const b1 = await fighter('g-b1')
    const busy = await fighter('g-busy')
    const late = await fighter('g-late')
    const made = await ApplicationsService.create(a1.user.id, { kind: 'GROUP', teamSize: 2, delayMinutes: 3 })
    await ApplicationsService.join(a2.user.id, made.battleId, 1)
    await ApplicationsService.join(b1.user.id, made.battleId, 2)
    await ApplicationsService.join(busy.user.id, made.battleId, 2)
    await expect(ApplicationsService.join(late.user.id, made.battleId, 1)).rejects.toMatchObject({ statusCode: 409 })

    // Пока заявка ждала, боец ушёл на смену: на старте он выпадает.
    await testPrisma.character.update({ where: { id: busy.character.id }, data: { status: 'WORKING' } })
    await expire(made.battleId)
    await runBattleApplications()

    const battle = await battleOf(made.battleId)
    expect(battle.status).toBe('ACTIVE')
    expect(battle.participants).toHaveLength(3)
    expect(battle.participants.some(p => p.characterId === busy.character.id)).toBe(false)
    expect(await statusOf(busy.character.id)).toBe('WORKING')
  })

  it('хаотичный бой делит стороны жребием поровну', async () => {
    const people = await Promise.all(['c1', 'c2', 'c3', 'c4'].map(name => fighter(name)))
    const made = await ApplicationsService.create(people[0].user.id, { kind: 'CHAOTIC', teamSize: 2, delayMinutes: 1 })
    for (const person of people.slice(1)) await ApplicationsService.join(person.user.id, made.battleId)
    await expire(made.battleId)
    await runBattleApplications()
    const battle = await battleOf(made.battleId)
    expect(battle.status).toBe('ACTIVE')
    expect(battle.participants.filter(p => p.side === 1)).toHaveLength(2)
    expect(battle.participants.filter(p => p.side === 2)).toHaveLength(2)
  })

  it('из заявки можно выйти, а уход создателя снимает её', async () => {
    const a = await fighter('lv-a')
    const b = await fighter('lv-b')
    const made = await ApplicationsService.create(a.user.id, { kind: 'GROUP', teamSize: 2, delayMinutes: 5 })
    await ApplicationsService.join(b.user.id, made.battleId, 2)
    // В двух заявках сразу стоять нельзя.
    await expect(ApplicationsService.create(b.user.id, { kind: 'DUEL' })).rejects.toMatchObject({ statusCode: 409 })

    expect(await ApplicationsService.leave(b.user.id, made.battleId)).toMatchObject({ cancelled: false })
    expect((await battleOf(made.battleId)).participants).toHaveLength(1)
    expect(await ApplicationsService.leave(a.user.id, made.battleId)).toMatchObject({ cancelled: true })
    expect((await battleOf(made.battleId)).status).toBe('CANCELLED')
  })

  it('чужой уровень в заявку не пускает', async () => {
    const a = await fighter('lvl-a', 10)
    const low = await fighter('lvl-low', 2)
    const made = await ApplicationsService.create(a.user.id, { kind: 'DUEL' })
    await expect(ApplicationsService.join(low.user.id, made.battleId)).rejects.toMatchObject({ statusCode: 409 })
  })
})
