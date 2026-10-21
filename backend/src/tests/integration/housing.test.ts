/**
 * Жилой сектор (правка заказчика 21.10.2026): жильё за доллары, бонус к
 * опыту, туннели, ремонт, налёты на дома (−10% прочности).
 * Жильё стоит заранее: участки 1…16 — квартиры, 17…24 — дома.
 * Уточнение 22.10: налёт — заявка и бой ровно через 72 часа, до 10 на
 * сторону, раз в неделю; из туннеля можно вернуться в дом тем же туннелем.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { HousingService, runHomeRaids } from '../../modules/housing/housing.service'
import { ChatService } from '../../modules/chat/chat.service'
import { HOUSING, LOTS, LOT_COUNT } from '../../modules/housing/housing.config'
import { CityService } from '../../modules/city/city.service'
import { BattleRedis, disconnectRedis, getRedis } from '../../shared/db/redis'

const HOUR = 3_600_000
import { cleanDatabase, testPrisma, uid } from './helpers'

async function player(prefix: string, dollars = 500, money = 50_000) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'STREET', hpCurrent: 100, hpMax: 100, money, dollars, battleLevel: 3, status: 'ACTIVE' },
  })
  await testPrisma.characterStats.create({ data: { characterId: character.id } })
  return { user, character }
}

const FLAT = 1
const HOUSE = LOTS.apartments + 1

describe('Жилой сектор', () => {
  beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })
  afterAll(async () => { await testPrisma.$disconnect(); await disconnectRedis() })

  it('жильё покупается только за доллары; квартиру можно улучшить до дома доплатой', async () => {
    const a = await player('buyer', 200)
    const flat = await HousingService.buy(a.character.id, FLAT)
    expect(flat.cost).toBe(HOUSING.kinds.APARTMENT.priceDollars)
    await expect(HousingService.buy(a.character.id, FLAT + 1)).rejects.toMatchObject({ statusCode: 409 })
    const house = await HousingService.buy(a.character.id, HOUSE)
    expect(house.cost).toBe(HOUSING.kinds.HOUSE.priceDollars - HOUSING.kinds.APARTMENT.priceDollars)
    const ch = await testPrisma.character.findUniqueOrThrow({ where: { id: a.character.id } })
    expect(ch.dollars).toBe(200 - HOUSING.kinds.HOUSE.priceDollars)
    expect(ch.money).toBe(50_000)
    // Переехал: квартира освободилась, дом занят.
    expect(house.home).toMatchObject({ kind: 'HOUSE', lot: HOUSE })
    const poor = await player('poor', 5)
    await expect(HousingService.buy(poor.character.id, FLAT)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('дом даёт прибавку к опыту; разбитый — нет; туннель и ремонт', async () => {
    const a = await player('owner')
    expect(await CityService.expBonus(a.character.id)).toBe(0)
    await HousingService.buy(a.character.id, HOUSE)
    expect(await CityService.expBonus(a.character.id)).toBeCloseTo(HOUSING.kinds.HOUSE.expBonus)

    const t = await HousingService.buyTunnel(a.character.id, 'pvp')
    expect(t.tunnels).toEqual(['pvp'])
    await expect(HousingService.buyTunnel(a.character.id, 'pvp')).rejects.toMatchObject({ statusCode: 409 })

    await testPrisma.playerHome.update({ where: { characterId: a.character.id }, data: { durability: 40 } })
    expect(await CityService.expBonus(a.character.id)).toBe(0)
    const fixed = await HousingService.repair(a.character.id)
    expect(fixed).toMatchObject({ durability: 100, cost: 6 * HOUSING.repairCostPer10 })
    expect(await CityService.expBonus(a.character.id)).toBeCloseTo(HOUSING.kinds.HOUSE.expBonus)
  })

  const due = (raidId: string) => testPrisma.homeRaid.update({ where: { id: raidId }, data: { startsAt: new Date(Date.now() - 1000) } })

  it('налёт: заявка, бой ровно через 72 часа; на свой дом нельзя; оборона не вышла — дом взят, неделя защиты', async () => {
    const owner = await player('home')
    await HousingService.buy(owner.character.id, FLAT)
    const home = await testPrisma.playerHome.findUniqueOrThrow({ where: { characterId: owner.character.id } })
    await expect(HousingService.fileRaid(owner.character.id, home.id)).rejects.toMatchObject({ statusCode: 409 })

    const thief = await player('thief')
    const now = new Date()
    const filed = await HousingService.fileRaid(thief.character.id, home.id, now)
    expect(new Date(filed.startsAt).getTime()).toBe(now.getTime() + HOUSING.raidLeadHours * HOUR)
    expect(HOUSING.raidLeadHours).toBe(72)
    const other = await player('other')
    await expect(HousingService.fileRaid(other.character.id, home.id)).rejects.toMatchObject({ statusCode: 409 })

    // Хозяин не в игре — оборона не вышла, дом взят без боя.
    await ChatService.touch(thief.character.id)
    await due(filed.raidId)
    await runHomeRaids()
    expect((await testPrisma.homeRaid.findUniqueOrThrow({ where: { id: filed.raidId } })).status).toBe('ATTACKER_WON')
    expect((await testPrisma.playerHome.findUniqueOrThrow({ where: { id: home.id } })).durability).toBe(100 - HOUSING.raidDurabilityLoss)
    const view = await HousingService.view(owner.character.id)
    expect(view.home!.raids[0]).toMatchObject({ won: true })

    // На этот дом — снова только через неделю, кто бы ни нападал.
    await expect(HousingService.fileRaid(other.character.id, home.id)).rejects.toThrow(/уже нападали/)
    await testPrisma.homeRaid.update({ where: { id: filed.raidId }, data: { resolvedAt: new Date(Date.now() - (HOUSING.raidCooldownDays * 24 + 1) * HOUR) } })
    await expect(HousingService.fileRaid(other.character.id, home.id)).resolves.toMatchObject({ owner: owner.character.nickname })
  })

  it('налёт: запись до 10 на сторону (хозяин — в обороне), бой открывается и подводится', async () => {
    const owner = await player('own2')
    await HousingService.buy(owner.character.id, HOUSE)
    const home = await testPrisma.playerHome.findUniqueOrThrow({ where: { characterId: owner.character.id } })
    const thief = await player('th2')
    const filed = await HousingService.fileRaid(thief.character.id, home.id)

    await expect(HousingService.signupRaid(owner.character.id, filed.raidId, 1)).rejects.toMatchObject({ statusCode: 409 })
    const friend = await player('fr2')
    expect(await HousingService.signupRaid(friend.character.id, filed.raidId, 2)).toMatchObject({ side: 2 })
    await expect(HousingService.signupRaid(friend.character.id, filed.raidId, 1)).rejects.toMatchObject({ statusCode: 409 })
    // В обороне хозяин и друг; ещё восемь мест, девятый не влезет.
    for (let i = 0; i < HOUSING.raidMaxPerSide - 2; i++) {
      const p = await player(`d${i}`)
      await HousingService.signupRaid(p.character.id, filed.raidId, 2)
    }
    const extra = await player('extra')
    await expect(HousingService.signupRaid(extra.character.id, filed.raidId, 2)).rejects.toMatchObject({ statusCode: 409 })
    await expect(HousingService.unsignRaid(thief.character.id, filed.raidId)).rejects.toMatchObject({ statusCode: 409 })

    const seen = await HousingService.view(friend.character.id)
    const lot = seen.lots.find(l => l.home?.id === home.id)!
    expect(lot.home!.raid).toMatchObject({ mySide: 2 })
    expect(lot.home!.raid!.defenders[0]).toMatchObject({ nickname: owner.character.nickname })

    // Обе стороны в игре — открывается бой; победила оборона — дом цел.
    await ChatService.touch(thief.character.id)
    await ChatService.touch(owner.character.id)
    await due(filed.raidId)
    await runHomeRaids()
    const raid = await testPrisma.homeRaid.findUniqueOrThrow({ where: { id: filed.raidId } })
    expect(raid.status).toBe('IN_BATTLE')
    expect(await BattleRedis.getState(raid.battleId!)).not.toBeNull()
    const battle = await testPrisma.battle.findUniqueOrThrow({ where: { id: raid.battleId! }, include: { participants: true } })
    const defender = battle.participants.find(p => p.side === 2)!
    await testPrisma.battle.update({ where: { id: battle.id }, data: { status: 'FINISHED', winnerParticipantId: defender.id, winnerId: defender.characterId } })
    await runHomeRaids()
    expect((await testPrisma.homeRaid.findUniqueOrThrow({ where: { id: filed.raidId } })).status).toBe('DEFENDER_WON')
    expect((await testPrisma.playerHome.findUniqueOrThrow({ where: { id: home.id } })).durability).toBe(100)
  })

  it('туннель: вышел из дома — можно вернуться; ушёл другой дорогой — нельзя', async () => {
    const a = await player('tun')
    await HousingService.buy(a.character.id, FLAT)
    await expect(HousingService.goThroughTunnel(a.character.id, 'farm')).rejects.toMatchObject({ statusCode: 409 })
    await HousingService.buyTunnel(a.character.id, 'farm')
    expect(await HousingService.goThroughTunnel(a.character.id, 'farm')).toEqual({ to: '/farm' })
    await CityService.move(a.user.id, '/farm')
    await CityService.move(a.user.id, '/plants')
    expect((await HousingService.exit(a.character.id)).via).toBe('farm')
    expect(await HousingService.returnHome(a.character.id)).toEqual({ to: '/housing' })

    // Вышел туннелем, потом ушёл на рынок — обратного хода нет.
    await HousingService.goThroughTunnel(a.character.id, 'farm')
    await CityService.move(a.user.id, '/farm')
    await CityService.move(a.user.id, '/market')
    expect((await HousingService.exit(a.character.id)).via).toBeNull()
    await expect(HousingService.returnHome(a.character.id)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('участки заданы заранее: занятый не купить, план сектора показывает хозяев', async () => {
    const a = await player('first')
    const b = await player('second')
    await HousingService.buy(a.character.id, 3)
    await expect(HousingService.buy(b.character.id, 3)).rejects.toMatchObject({ statusCode: 409 })
    await expect(HousingService.buy(b.character.id, 0)).rejects.toMatchObject({ statusCode: 422 })
    await expect(HousingService.buy(b.character.id, LOT_COUNT + 1)).rejects.toMatchObject({ statusCode: 422 })

    const view = await HousingService.view(b.character.id)
    expect(view.lots).toHaveLength(LOT_COUNT)
    expect(view.lots.filter(l => l.kind === 'APARTMENT')).toHaveLength(LOTS.apartments)
    expect(view.lots[2]).toMatchObject({ lot: 3, label: 'Кв. 3', home: { owner: a.character.nickname, mine: false } })
    expect(view.lots[HOUSE - 1]).toMatchObject({ label: 'Дом 1', kind: 'HOUSE', home: null })
    expect((await HousingService.view(a.character.id)).lots[2].home).toMatchObject({ mine: true })
  })
})
