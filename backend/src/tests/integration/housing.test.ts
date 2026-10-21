/**
 * Жилой сектор (правка заказчика 21.10.2026): жильё за доллары, бонус к
 * опыту, туннели, ремонт, налёты на дома (бой со сторожем, −10% прочности).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { HousingService } from '../../modules/housing/housing.service'
import { HOUSING } from '../../modules/housing/housing.config'
import { CityService } from '../../modules/city/city.service'
import { BattleRedis, disconnectRedis, getRedis } from '../../shared/db/redis'
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

describe('Жилой сектор', () => {
  beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })
  afterAll(async () => { await testPrisma.$disconnect(); await disconnectRedis() })

  it('жильё покупается только за доллары; квартиру можно улучшить до дома доплатой', async () => {
    const a = await player('buyer', 200)
    const flat = await HousingService.buy(a.character.id, 'APARTMENT')
    expect(flat.cost).toBe(HOUSING.kinds.APARTMENT.priceDollars)
    await expect(HousingService.buy(a.character.id, 'APARTMENT')).rejects.toMatchObject({ statusCode: 409 })
    const house = await HousingService.buy(a.character.id, 'HOUSE')
    expect(house.cost).toBe(HOUSING.kinds.HOUSE.priceDollars - HOUSING.kinds.APARTMENT.priceDollars)
    const ch = await testPrisma.character.findUniqueOrThrow({ where: { id: a.character.id } })
    expect(ch.dollars).toBe(200 - HOUSING.kinds.HOUSE.priceDollars)
    expect(ch.money).toBe(50_000)
    const poor = await player('poor', 5)
    await expect(HousingService.buy(poor.character.id, 'APARTMENT')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('дом даёт прибавку к опыту; разбитый — нет; туннель и ремонт', async () => {
    const a = await player('owner')
    expect(await CityService.expBonus(a.character.id)).toBe(0)
    await HousingService.buy(a.character.id, 'HOUSE')
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

  it('налёт: бой со сторожем; победа нападавшего −10%; повтор только через сутки; на свой дом нельзя', async () => {
    const owner = await player('home')
    await HousingService.buy(owner.character.id, 'APARTMENT')
    const home = await testPrisma.playerHome.findUniqueOrThrow({ where: { characterId: owner.character.id } })
    await expect(HousingService.raid(owner.user.id, owner.character.id, home.id)).rejects.toMatchObject({ statusCode: 409 })

    const thief = await player('thief')
    const { battleId } = await HousingService.raid(thief.user.id, thief.character.id, home.id)
    expect(await testPrisma.homeRaid.count({ where: { homeId: home.id, status: 'PENDING' } })).toBe(1)

    // Бой со сторожем закончился победой нападавшего.
    const part = await testPrisma.battleParticipant.findFirstOrThrow({ where: { battleId, characterId: thief.character.id } })
    await testPrisma.battle.update({ where: { id: battleId }, data: { status: 'FINISHED', winnerParticipantId: part.id, finishedAt: new Date() } })
    await BattleRedis.deleteState(battleId)
    await testPrisma.character.update({ where: { id: thief.character.id }, data: { status: 'ACTIVE' } })
    await HousingService.settle()
    expect((await testPrisma.playerHome.findUniqueOrThrow({ where: { id: home.id } })).durability).toBe(90)
    expect((await testPrisma.homeRaid.findFirstOrThrow({ where: { battleId } })).status).toBe('ATTACKER_WON')

    await expect(HousingService.raid(thief.user.id, thief.character.id, home.id)).rejects.toMatchObject({ statusCode: 409 })
    const view = await HousingService.view(owner.character.id)
    expect(view.home!.raids[0]).toMatchObject({ won: true })
  })
})
