/**
 * Шмот для собак из админки (Дима 10.11: «в админке вкладка нужна под шмот для
 * собак… статы так же разбивать сам игрок будет. И именные для собак отдельно (ЦУМ)»).
 * Вещь заводят в справочнике, игрок покупает её на собаку и сам раскладывает очки;
 * именная продаётся за доллары. Старые четыре вещи с зашитым бонусом работают как раньше.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { hashPassword } from '../../shared/security/password'
import { generateJti, storeAdminSession } from '../../shared/security/jwt'
import { CityService } from '../../modules/city/city.service'
import { dogSummary } from '../../modules/city/city.config'
import { cleanDatabase, testPrisma, uid } from './helpers'

const REASON = 'шмот для собак по просьбе Димы'

describe('шмот для собак из админки', () => {
  let app: FastifyInstance
  let token = ''
  const auth = () => ({ authorization: `Bearer ${token}` })

  beforeAll(async () => {
    await testPrisma.$connect()
    app = await buildApp()
    await app.ready()
    const row = await testPrisma.adminUser.create({ data: { username: uid('dgear'), passwordHash: await hashPassword('x'), role: 'SUPER_ADMIN' } })
    const jti = generateJti()
    await storeAdminSession(jti, row.id)
    token = app.jwt.sign({ role: 'admin', adminRole: row.role, adminId: row.id, jti }, { expiresIn: '1h' })
  })
  beforeEach(async () => { await cleanDatabase() })
  afterAll(async () => {
    await testPrisma.adminActionLog.deleteMany()
    await testPrisma.adminUser.deleteMany({ where: { username: { startsWith: 'dgear' } } })
    await app.close()
    await testPrisma.$disconnect()
  })

  async function owner() {
    const login = uid('dg')
    const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
    const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money: 50_000, dollars: 100 } })
    const pet = await testPrisma.characterPet.create({ data: { characterId: character.id, code: 'mastiff', name: 'Мастифф' } })
    return { character, pet }
  }

  const create = (fields: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/admin/catalog/dog-gear', headers: auth(), payload: { fields, reason: REASON } })

  it('админ заводит вещь, игрок покупает и сам раскладывает очки; бонус собаки растёт', async () => {
    const res = await create({ slot: 'ARMOR', name: 'Бронежилет для пса', price: 4000, statBudget: 20 })
    expect(res.statusCode).toBe(201)
    const { code } = res.json<{ code: string }>()

    const { character, pet } = await owner()
    const shop = await CityService.pets(character.id)
    expect(shop.gear.find(g => g.code === code)).toMatchObject({ slot: 'ARMOR', price: 4000, currency: 'RUB', budget: 20, named: false })

    await CityService.buyDogGear(character.id, pet.id, code, uid('k'))
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).money).toBe(46_000)
    await expect(CityService.buyDogGear(character.id, pet.id, code, uid('k'))).rejects.toMatchObject({ message: 'Это уже надето' })

    await CityService.allocateDogGear(character.id, pet.id, 'ARMOR', { end: 12, agi: 5 })
    await expect(CityService.allocateDogGear(character.id, pet.id, 'ARMOR', { luck: 4 })).rejects.toMatchObject({ message: 'Свободных очков у вещи: 3' })
    await CityService.allocateDogGear(character.id, pet.id, 'ARMOR', { luck: 3 })

    const dog = dogSummary(await testPrisma.characterPet.findMany({ where: { characterId: character.id } }))!
    expect(dog.gear.ARMOR).toMatchObject({ code, name: 'Бронежилет для пса', budget: 20, free: 0, bonus: { end: 12, agi: 5, luck: 3 } })
    // Мастифф: свои очки в выносливость (2 на 1-м уровне) плюс вложенное в жилет.
    expect(dog.fullBonus).toMatchObject({ end: 14, agi: 5, luck: 3 })
  })

  it('именная вещь — за доллары и видна как товар за $ (ЦУМ); без цены в долларах не заводится', async () => {
    expect((await create({ slot: 'COLLAR', name: 'Именной ошейник', named: true, price: 500, statBudget: 30 })).statusCode).toBe(422)
    const res = await create({ slot: 'COLLAR', name: 'Именной ошейник', named: true, priceDollars: 15, statBudget: 30 })
    expect(res.statusCode).toBe(201)
    const { code } = res.json<{ code: string }>()

    const { character, pet } = await owner()
    expect((await CityService.pets(character.id)).gear.find(g => g.code === code)).toMatchObject({ price: 15, currency: 'USD', named: true })
    await CityService.buyDogGear(character.id, pet.id, code, uid('k'))
    const after = await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })
    expect(after).toMatchObject({ money: 50_000, dollars: 85 })
  })

  it('снятая с продажи вещь не покупается, но у купивших остаётся; правка шаблона купленное не меняет', async () => {
    const { code } = (await create({ slot: 'BOOTS', name: 'Боты', price: 1000, statBudget: 10 })).json<{ code: string }>()
    const { character, pet } = await owner()
    await CityService.buyDogGear(character.id, pet.id, code, uid('k'))

    const off = await app.inject({ method: 'PATCH', url: `/api/admin/catalog/dog-gear/${code}`, headers: auth(), payload: { fields: { isActive: false, statBudget: 50 }, reason: REASON } })
    expect(off.statusCode).toBe(200)
    expect((await CityService.pets(character.id)).gear.some(g => g.code === code)).toBe(false)

    const other = await owner()
    await expect(CityService.buyDogGear(other.character.id, other.pet.id, code, uid('k'))).rejects.toMatchObject({ message: 'Нет такого снаряжения' })
    const dog = dogSummary(await testPrisma.characterPet.findMany({ where: { characterId: character.id } }))!
    expect(dog.gear.BOOTS).toMatchObject({ budget: 10, free: 10 })
    expect(pet.id).toBeTruthy()
  })

  it('старые вещи с зашитым бонусом не продаются (Дима 14.11), но надетые ещё читаются', async () => {
    const { character, pet } = await owner()
    await expect(CityService.buyDogGear(character.id, pet.id, 'dog_boots', uid('k'))).rejects.toMatchObject({ message: 'Нет такого снаряжения' })
    expect((await CityService.pets(character.id)).gear.some(g => g.code === 'dog_boots')).toBe(false)
    await testPrisma.characterPet.update({ where: { id: pet.id }, data: { gear: { BOOTS: 'dog_boots' } } })
    const dog = dogSummary(await testPrisma.characterPet.findMany({ where: { characterId: character.id } }))!
    expect(dog.gear.BOOTS).toMatchObject({ code: 'dog_boots', bonus: { agi: 1 } })
    await expect(CityService.allocateDogGear(character.id, pet.id, 'BOOTS', { agi: 1 })).rejects.toMatchObject({ message: 'На этой вещи нечего распределять' })
  })
})
