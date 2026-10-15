/**
 * Осада дома бригады — правка заказчика «как в Королях». Проверяется то, на
 * чём такая механика ломается: время заявки, кто может её подать, кто
 * попадает в бой, последствия взятия и отбитой осады, пауза до следующей.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { HouseSiegeService, runHouseSieges } from '../../modules/clans/house-siege.service'
import { siegeStartAllowed } from '../../modules/clans/house-siege.formulas'
import { ClansService } from '../../modules/clans/clans.service'
import { ChatService } from '../../modules/chat/chat.service'
import { ApplicationsService } from '../../modules/battles/applications.service'
import { TerritoriesService } from '../../modules/territories/territories.service'
import { BattleRedis, disconnectRedis, getRedis } from '../../shared/db/redis'
import { cleanDatabase, testPrisma, uid } from './helpers'

const HOUR = 3_600_000

/** Ближайшее разрешённое время начала: через 3 суток, будни, 11–20 по Москве. */
function nextAllowedStart(now = new Date()): Date {
  for (let hours = 72; hours < 7 * 24; hours++) {
    const candidate = new Date(Math.ceil((now.getTime() + hours * HOUR) / HOUR) * HOUR)
    if (!siegeStartAllowed(candidate, now)) return candidate
  }
  throw new Error('нет разрешённого времени')
}

describe('осада дома бригады', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => {
    await cleanDatabase()
    await getRedis().flushdb()
  })
  afterAll(async () => {
    await testPrisma.$disconnect()
    await disconnectRedis()
  })

  async function player(prefix: string) {
    const login = uid(prefix)
    const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
    const character = await testPrisma.character.create({
      data: { userId: user.id, nickname: login, archetype: 'STREET', hpCurrent: 100, hpMax: 100, money: 50_000, battleLevel: 6, status: 'ACTIVE' },
    })
    await testPrisma.characterStats.create({ data: { characterId: character.id } })
    return { user, character }
  }
  async function brigade(prefix: string, fighters = 1) {
    const boss = await player(`${prefix}b`)
    const clan = await ClansService.create(boss.character.id, uid(`${prefix}-c`).slice(0, 30), Math.random().toString(36).slice(2, 6).toUpperCase())
    const role = await testPrisma.clanRole.findFirstOrThrow({ where: { clanId: clan.id, code: 'fighter' } })
    const others = []
    for (let i = 1; i < fighters; i++) {
      const mate = await player(`${prefix}m${i}`)
      await testPrisma.clanMember.create({ data: { clanId: clan.id, characterId: mate.character.id, roleId: role.id } })
      await testPrisma.character.update({ where: { id: mate.character.id }, data: { clanId: clan.id } })
      others.push(mate)
    }
    await testPrisma.clan.update({ where: { id: clan.id }, data: { treasury: 20_000 } })
    return { boss, clan, others }
  }
  const expire = (siegeId: string) => testPrisma.houseSiege.update({ where: { id: siegeId }, data: { startsAt: new Date(Date.now() - 1000) } })

  it('время осады: не раньше трёх суток, только будни с 11 до 20 по Москве', () => {
    const now = new Date('2026-10-14T09:00:00Z') // среда, 12:00 по Москве
    expect(siegeStartAllowed(new Date('2026-10-15T09:00:00Z'), now)).toMatch(/не раньше/)
    expect(siegeStartAllowed(new Date('2026-10-17T09:00:00Z'), now)).toMatch(/будни/) // суббота
    expect(siegeStartAllowed(new Date('2026-10-19T06:00:00Z'), now)).toMatch(/с 11:00/) // пн 09:00 МСК
    expect(siegeStartAllowed(new Date('2026-10-19T17:00:00Z'), now)).toMatch(/с 11:00/) // пн 20:00 МСК
    expect(siegeStartAllowed(new Date('2026-10-19T09:00:00Z'), now)).toBeNull() // пн 12:00 МСК
    expect(siegeStartAllowed(new Date('2026-10-23T09:00:00Z'), now)).toMatch(/не позже/)
  })

  it('объявляет только главарь, один дом — одна осада, чужие не записываются', async () => {
    const red = await brigade('red', 2)
    const blue = await brigade('blue')
    const green = await brigade('green')
    const startsAt = nextAllowedStart()
    await expect(HouseSiegeService.file(red.others[0].character.id, blue.clan.id, startsAt)).rejects.toMatchObject({ statusCode: 403 })
    const filed = await HouseSiegeService.file(red.boss.character.id, blue.clan.id, startsAt)
    await expect(HouseSiegeService.file(green.boss.character.id, blue.clan.id, startsAt)).rejects.toMatchObject({ statusCode: 409 })
    await expect(HouseSiegeService.signup(green.boss.character.id, filed.siegeId)).rejects.toMatchObject({ statusCode: 403 })
    expect(await HouseSiegeService.signup(red.others[0].character.id, filed.siegeId)).toMatchObject({ side: 1 })
    expect(await HouseSiegeService.signup(blue.boss.character.id, filed.siegeId)).toMatchObject({ side: 2 })
    expect(await testPrisma.announcement.count({ where: { title: 'Объявлена осада' } })).toBe(1)

    // Запись не держит игрока: записавшийся свободно подаёт обычную заявку.
    expect((await ApplicationsService.create(red.others[0].user.id, { kind: 'DUEL' })).status).toBe('WAITING_PLAYERS')
  })

  it('оборона не вышла — дом взят без боя: прочность −5%, разгром, бонусы района выключены', async () => {
    const red = await brigade('r2')
    const blue = await brigade('b2')
    const filed = await HouseSiegeService.file(red.boss.character.id, blue.clan.id, nextAllowedStart())
    await ChatService.touch(red.boss.character.id) // нападающий в игре, обороны нет
    await expire(filed.siegeId)
    await runHouseSieges()

    const siege = await testPrisma.houseSiege.findUniqueOrThrow({ where: { id: filed.siegeId } })
    expect(siege.status).toBe('ATTACKERS_WON')
    const house = await testPrisma.clan.findUniqueOrThrow({ where: { id: blue.clan.id } })
    expect(house.houseDurability).toBe(95)
    expect(house.houseRazedUntil!.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * HOUR)

    await testPrisma.territory.create({ data: { code: uid('t'), name: 'Район', bonusCode: 'WORK_SALARY', bonusValue: 0.1, ownerClanId: blue.clan.id, status: 'CONTROLLED' } })
    expect(await TerritoriesService.bonusesForClan(blue.clan.id)).toEqual({})
    expect(await testPrisma.character.findUniqueOrThrow({ where: { id: red.boss.character.id } })).toMatchObject({ status: 'ACTIVE' })

    // Гость пишет на стене; хозяева на своей — нет; больше пяти — нельзя.
    const guest = await player('guest')
    for (let i = 0; i < 5; i++) await HouseSiegeService.writeOnWall(guest.character.id, blue.clan.id, `Тут были ${i}`)
    await expect(HouseSiegeService.writeOnWall(guest.character.id, blue.clan.id, 'шестая')).rejects.toMatchObject({ statusCode: 409 })
    await expect(HouseSiegeService.writeOnWall(blue.boss.character.id, blue.clan.id, 'своя')).rejects.toMatchObject({ statusCode: 422 })
    const view = await HouseSiegeService.view(guest.character.id, blue.clan.id)
    expect(view.wall).toHaveLength(5)
    expect(view.bonusesOff).toBe(true)

    // Ремонт из общака возвращает прочность.
    const repaired = await HouseSiegeService.repair(blue.boss.character.id)
    expect(repaired).toMatchObject({ durability: 100, cost: 2000, treasury: 18_000 })

    // Повторная осада — через 15 суток.
    const again = await HouseSiegeService.view(red.boss.character.id, blue.clan.id)
    expect(again.canFile).toBe(false)
    expect(again.fileBlocked).toMatch(/Следующую осаду/)
  })

  it('бой осады: отбитая осада даёт нападавшим травму, и в бой с ней нельзя', async () => {
    const red = await brigade('r3')
    const blue = await brigade('b3')
    const filed = await HouseSiegeService.file(red.boss.character.id, blue.clan.id, nextAllowedStart())
    await ChatService.touch(red.boss.character.id)
    await ChatService.touch(blue.boss.character.id)
    await expire(filed.siegeId)
    await runHouseSieges()

    const siege = await testPrisma.houseSiege.findUniqueOrThrow({ where: { id: filed.siegeId } })
    expect(siege.status).toBe('IN_BATTLE')
    expect(await BattleRedis.getState(siege.battleId!)).not.toBeNull()
    const battle = await testPrisma.battle.findUniqueOrThrow({ where: { id: siege.battleId! }, include: { participants: true } })
    expect(battle.status).toBe('ACTIVE')
    expect(battle.participants.map(p => p.side).sort()).toEqual([1, 2])

    // Бой закончился победой обороны.
    const defender = battle.participants.find(p => p.side === 2)!
    await testPrisma.battle.update({ where: { id: battle.id }, data: { status: 'FINISHED', winnerParticipantId: defender.id, winnerId: defender.characterId } })
    await testPrisma.character.updateMany({ where: { id: { in: [red.boss.character.id, blue.boss.character.id] } }, data: { status: 'ACTIVE' } })
    await runHouseSieges()

    expect((await testPrisma.houseSiege.findUniqueOrThrow({ where: { id: filed.siegeId } })).status).toBe('DEFENDERS_WON')
    const attacker = await testPrisma.character.findUniqueOrThrow({ where: { id: red.boss.character.id } })
    expect(attacker.traumaUntil!.getTime()).toBeGreaterThan(Date.now() + 23 * HOUR)
    await expect(ApplicationsService.create(red.boss.user.id, { kind: 'DUEL' })).rejects.toThrow(/Кровавая травма/)
    expect((await testPrisma.clan.findUniqueOrThrow({ where: { id: blue.clan.id } })).houseDurability).toBe(100)
  })

  it('главарь может снять осаду до начала, и это тоже запускает паузу', async () => {
    const red = await brigade('r4')
    const blue = await brigade('b4')
    const filed = await HouseSiegeService.file(red.boss.character.id, blue.clan.id, nextAllowedStart())
    await HouseSiegeService.cancel(red.boss.character.id, filed.siegeId)
    expect((await testPrisma.houseSiege.findUniqueOrThrow({ where: { id: filed.siegeId } })).status).toBe('CANCELLED')
    expect((await HouseSiegeService.view(red.boss.character.id, blue.clan.id)).fileBlocked).toMatch(/Следующую осаду/)
  })
})
