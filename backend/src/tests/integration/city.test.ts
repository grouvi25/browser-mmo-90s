import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { testPrisma, cleanDatabase, uid } from './helpers'
import { CityService } from '../../modules/city/city.service'
import { seedCity } from '../../../prisma/seed-city'
import { ItemStatsService } from '../../modules/items/item-stats.service'
import { buildApp } from '../../app'
import { storeSession, storeAdminSession } from '../../shared/security/jwt'

let app: FastifyInstance
beforeAll(async () => { app = await buildApp(); await app.ready() })
afterAll(async () => { await app.close(); await testPrisma.$disconnect() })
beforeEach(async () => { await cleanDatabase(); await testPrisma.itemTemplate.deleteMany({ where: { code: { in: ['berezka_experience_amulet', 'tsum_named_knife', 'tsum_named_jacket'] } } }); await seedCity(testPrisma) })
async function player(money = 100000) {
  const login = uid('city')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'test-only' } })
  const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login, archetype: 'WORKER', hpMax: 100, hpCurrent: 100, money, dollars: 100 } })
  const jti = randomUUID(); await storeSession(jti, user.id)
  const token = app.jwt.sign({ sub: user.id, jti })
  return { user, character, headers: { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() } }
}
describe('city locations and purchases', () => {
  it('saves location on the character and restores it without browser storage', async () => {
    const p = await player(); await CityService.move(p.user.id, '/school')
    expect((await CityService.location(p.user.id)).path).toBe('/school')
    await expect(CityService.move(p.user.id, '//evil.test')).rejects.toThrow()
  })
  it('requires authorization and validates route bodies', async () => {
    expect((await app.inject({ url: '/api/city/pets' })).statusCode).toBe(401)
    const p = await player()
    expect((await app.inject({ method: 'PUT', url: '/api/city/location', headers: p.headers, payload: { path: 1 } })).statusCode).toBe(422)
    expect((await app.inject({ method: 'POST', url: '/api/city/pets', headers: { authorization: p.headers.authorization }, payload: { code: 'mastiff' } })).statusCode).toBe(422)
  })
  it('buys a profession once, preserves progression and replays without double debit', async () => {
    const p = await player(); const k = randomUUID()
    await CityService.learn(p.character.id, 'gunsmith', k)
    await CityService.learn(p.character.id, 'gunsmith', k)
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: p.character.id } })).money).toBe(99500)
    await expect(CityService.learn(p.character.id, 'gunsmith', randomUUID())).rejects.toThrow()
    expect(await testPrisma.characterProfession.count({ where: { characterId: p.character.id } })).toBe(1)
  })
  it('does not spend money when a purchase cannot be completed', async () => {
    const p = await player(1)
    await expect(CityService.buyPet(p.character.id, 'mastiff', randomUUID())).rejects.toThrow()
    expect(await testPrisma.characterPet.count({ where: { characterId: p.character.id } })).toBe(0)
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: p.character.id } })).money).toBe(1)
  })
  it('creates named item with all its stat budget unallocated, then allocates points', async () => {
    const p = await player(); const item = (await CityService.catalog('tsum')).items[0]
    const bought = await CityService.buyItem(p.character.id, 'tsum', item.id, randomUUID())
    expect(bought.item.freePoints).toBe(item.statBudget)
    // ЦУМ торгует за доллары: рубли не тронуты (правка заказчика).
    const after = await testPrisma.character.findUniqueOrThrow({ where: { id: p.character.id } })
    expect(after.money).toBe(100000)
    expect(after.dollars).toBe(100 - item.priceDollars!)
    expect(bought.item.statAllocation).toBe(null)
    await ItemStatsService.allocate(p.character.id, bought.item.id, 'DAMAGE', 2)
    expect((await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: bought.item.id } })).freePoints).toBe(item.statBudget - 2)
  })
  it('очки вещи прибавляются к её характеристикам в инвентаре, новые — отдельной строкой', async () => {
    // Правка заказчика 21.10: «Урон когда добавляем, он просто идёт + урон…
    // нужно, чтобы добавлялось к уже готовым статам». Инвентарь отдаёт итог
    // той же формулой, что бой.
    const p = await player(); const item = (await CityService.catalog('tsum')).items.find(i => i.type === 'WEAPON')!
    const bought = await CityService.buyItem(p.character.id, 'tsum', item.id, randomUUID())
    const read = async () => (await app.inject({ method: 'GET', url: '/api/inventory', headers: p.headers })).json<Array<{ id: string; effective: { minDamage: number; maxDamage: number; weaponAccuracy: number } }>>().find(i => i.id === bought.item.id)!.effective
    const before = await read()
    await ItemStatsService.allocate(p.character.id, bought.item.id, 'DAMAGE', 5)
    await ItemStatsService.allocate(p.character.id, bought.item.id, 'ACCURACY', 3)
    const after = await read()
    expect(after.maxDamage).toBeGreaterThan(before.maxDamage)
    expect(after.minDamage).toBeGreaterThanOrEqual(before.minDamage)
    expect(after.weaponAccuracy).toBeCloseTo(before.weaponAccuracy + 0.03, 5)
  })
  it('never sells basic government goods in premium city shops', async () => {
    const p = await player()
    const basic = await testPrisma.itemTemplate.create({ data: { code: uid('basic'), name: 'Basic', type: 'ARMOR' } })
    await expect(CityService.buyItem(p.character.id, 'tsum', basic.id, randomUUID())).rejects.toThrow()
  })
  it('grants artifact experience only while equipped and unbroken', async () => {
    const p = await player(); const t = (await CityService.catalog('berezka')).items[0]
    const { item } = await CityService.buyItem(p.character.id, 'berezka', t.id, randomUUID())
    expect(await CityService.expBonus(p.character.id)).toBe(0)
    const equipped = await app.inject({ method: 'POST', url: '/api/inventory/equip', headers: p.headers, payload: { itemInstanceId: item.id } })
    expect(equipped.statusCode).toBe(200)
    expect((await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: item.id } })).armorSlot).toBe('ACCESSORY')
    expect(t.dodgeBonus).toBe(.03)
    expect(await CityService.expBonus(p.character.id)).toBe(.1)
    await testPrisma.itemInstance.update({ where: { id: item.id }, data: { durabilityCurrent: 0 } })
    expect(await CityService.expBonus(p.character.id)).toBe(0)
  })
  it('корм покупается сроком: рубли и доллары, чужой собаке не скормить', async () => {
    const p = await player(); const other = await player()
    const { pet } = await CityService.buyPet(p.character.id, 'mastiff', randomUUID())
    await expect(CityService.buyFeedPack(other.character.id, pet.id, 'food_72h', randomUUID())).rejects.toThrow()
    const k = randomUUID()
    await CityService.buyFeedPack(p.character.id, pet.id, 'food_72h', k)
    await CityService.buyFeedPack(p.character.id, pet.id, 'food_72h', k) // повтор запроса не списывает дважды
    const fed = (await testPrisma.characterPet.findUniqueOrThrow({ where: { id: pet.id } })).fedUntil!
    expect(fed.getTime() - Date.now()).toBeGreaterThan(71 * 3_600_000)
    expect(fed.getTime() - Date.now()).toBeLessThan(73 * 3_600_000)
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: p.character.id } })).money).toBe(100000 - 3000 - 150)

    // Двухнедельный корм — за доллары, срок прибавляется к уже купленному.
    await testPrisma.character.update({ where: { id: p.character.id }, data: { dollars: 0 } })
    await expect(CityService.buyFeedPack(p.character.id, pet.id, 'food_2w', randomUUID())).rejects.toThrow('долларов')
    await testPrisma.character.update({ where: { id: p.character.id }, data: { dollars: 10 } })
    await CityService.buyFeedPack(p.character.id, pet.id, 'food_2w', randomUUID())
    const after = await testPrisma.characterPet.findUniqueOrThrow({ where: { id: pet.id } })
    expect(after.fedUntil!.getTime() - fed.getTime()).toBe(336 * 3_600_000)
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: p.character.id } })).dollars).toBe(5)
  })
  it('одна собака на персонажа: кота нет, вторую породу не купить', async () => {
    const p = await player()
    await expect(CityService.buyPet(p.character.id, 'cat', randomUUID())).rejects.toThrow()
    const attempts = await Promise.allSettled([
      CityService.buyPet(p.character.id, 'mastiff', randomUUID()),
      CityService.buyPet(p.character.id, 'doberman', randomUUID()),
    ])
    expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1)
    expect(await testPrisma.characterPet.count({ where: { characterId: p.character.id } })).toBe(1)
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: p.character.id } })).money).toBe(97000)
  })
  it('кот и пёс прошлого выката бесплатно меняются на одну собаку с их сытостью и кормом', async () => {
    const p = await player()
    const fed = new Date(Date.now() + 5 * 3_600_000)
    await testPrisma.characterPet.createMany({ data: [
      { characterId: p.character.id, code: 'cat', name: 'Кот', food: 2, fedUntil: fed },
      { characterId: p.character.id, code: 'dog', name: 'Пёс', food: 1 },
    ] })
    await expect(CityService.exchangeLegacyPet(p.character.id, 'cat', randomUUID())).rejects.toThrow()
    const { pet } = await CityService.exchangeLegacyPet(p.character.id, 'doberman', randomUUID())
    expect(pet).toMatchObject({ code: 'doberman', name: 'Доберман', food: 3 })
    expect(pet.fedUntil!.getTime()).toBe(fed.getTime())
    expect(await testPrisma.characterPet.count({ where: { characterId: p.character.id } })).toBe(1)
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: p.character.id } })).money).toBe(100000)
    await expect(CityService.exchangeLegacyPet(p.character.id, 'mastiff', randomUUID())).rejects.toThrow('Менять нечего')
  })
  it('донатная собака за доллары: свои очки распределяет игрок, снаряжение даёт бонус', async () => {
    const p = await player()
    const { pet } = await CityService.buyPet(p.character.id, 'pitbull', randomUUID())
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: p.character.id } })).dollars).toBe(100 - 25)
    await CityService.allocateDog(p.character.id, pet.id, 'str', 1)
    await CityService.allocateDog(p.character.id, pet.id, 'str', 1)
    await CityService.allocateDog(p.character.id, pet.id, 'luck', 1)
    await expect(CityService.allocateDog(p.character.id, pet.id, 'agi', 1)).rejects.toThrow('Свободных очков нет')
    await CityService.buyDogGear(p.character.id, pet.id, 'dog_collar_spiked', randomUUID())
    const state = await CityService.pets(p.character.id)
    expect(state.dog?.fullBonus).toEqual({ str: 2, luck: 2 })
    expect(state.dog?.freePoints).toBe(0)
  })
  it('у стандартной собаки очки не распределяются; сытая собака растёт от опыта хозяина', async () => {
    const p = await player()
    const { pet } = await CityService.buyPet(p.character.id, 'mastiff', randomUUID())
    await expect(CityService.allocateDog(p.character.id, pet.id, 'str', 1)).rejects.toThrow('донатной')
    await testPrisma.characterPet.update({ where: { id: pet.id }, data: { fedUntil: new Date(Date.now() + 3_600_000) } })
    const { applyBattleProgression } = await import('../../modules/experience/progression')
    await testPrisma.characterStats.create({ data: { characterId: p.character.id } })
    const char = await testPrisma.character.findUniqueOrThrow({ where: { id: p.character.id }, include: { stats: true } })
    await testPrisma.$transaction(tx => applyBattleProgression(tx, char, { expGain: 200, hpCurrentAfterBattle: 50, won: true }))
    const after = await testPrisma.characterPet.findUniqueOrThrow({ where: { id: pet.id } })
    expect(after.exp).toBe(100)
    expect(after.level).toBe(2)
  })
  it('enforces prison server-side, releases automatically, keeps GET available', async () => {
    const p = await player()
    await testPrisma.character.update({ where: { id: p.character.id }, data: { jailedUntil: new Date(Date.now() + 3600000), jailReason: 'Тестовое наказание' } })
    expect((await CityService.location(p.user.id)).path).toBe('/prison')
    expect((await app.inject({ method: 'POST', url: '/api/city/pets', headers: p.headers, payload: { code: 'mastiff' } })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/city/location', headers: p.headers })).statusCode).toBe(200)
    await expect(CityService.move(p.user.id, '/school')).rejects.toThrow()
    await testPrisma.character.update({ where: { id: p.character.id }, data: { jailedUntil: new Date(0) } })
    expect((await app.inject({ method: 'POST', url: '/api/city/pets', headers: p.headers, payload: { code: 'mastiff' } })).statusCode).toBe(200)
  })
  it('admin jail and release execute and write reversible audit records', async () => {
    const p = await player(); const id = randomUUID()
    const admin = await testPrisma.adminUser.create({ data: { username: uid('admin'), passwordHash: 'test-only', role: 'MODERATOR' } })
    await storeAdminSession(id, admin.id)
    const headers = { authorization: `Bearer ${app.jwt.sign({ role: 'admin', adminId: admin.id, jti: id })}` }
    const res = await app.inject({ method: 'POST', url: '/api/admin/city/prison', headers, payload: { characterId: p.character.id, hours: 24, reason: 'Обоснованное тестовое наказание' } })
    expect(res.statusCode).toBe(200)
    expect((await CityService.location(p.user.id)).path).toBe('/prison')
    expect(await testPrisma.adminActionLog.count({ where: { targetId: p.character.id, kind: 'JAIL_CHARACTER' } })).toBe(1)
    await app.inject({ method: 'POST', url: '/api/admin/city/prison', headers, payload: { characterId: p.character.id, hours: 0, reason: 'Обоснованное освобождение игрока' } })
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: p.character.id } })).jailedUntil).toBe(null)
  })
  it('database prevents a clan owning a second district', async () => {
    const clan = await testPrisma.clan.create({ data: { name: uid('clan'), tag: uid('tag') } })
    expect(clan.territoryLimit).toBe(1)
    await testPrisma.territory.create({ data: { code: uid('first'), name: 'first', ownerClanId: clan.id, status: 'CONTROLLED', bonusCode: 'BATTLE_EXP', bonusValue: .1 } })
    await expect(testPrisma.territory.create({ data: { code: uid('second'), name: 'second', ownerClanId: clan.id, status: 'CONTROLLED', bonusCode: 'BATTLE_EXP', bonusValue: .1 } })).rejects.toThrow()
  })
})
