/**
 * Новая вещь из админки целиком (просьба заказчика 25.10: «по шмоту — буду
 * сам добавлять»). Вещь должна сразу надеваться (слот), нести очки статов и
 * продаваться — иначе созданное из админки в игре бесполезно.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { hashPassword } from '../../shared/security/password'
import { generateJti, storeAdminSession } from '../../shared/security/jwt'
import { PrivateShopsService } from '../../modules/private-shops/private-shops.service'
import { cleanDatabase, testPrisma, uid } from './helpers'

const REASON = 'новая линейка шмота по документу'

describe('админка: новая вещь', () => {
  let app: FastifyInstance
  let token = ''
  let moderatorToken = ''

  async function admin(role: 'SUPER_ADMIN' | 'MODERATOR') {
    const row = await testPrisma.adminUser.create({ data: { username: uid(`items-${role.toLowerCase()}`), passwordHash: await hashPassword('x'), role } })
    const jti = generateJti()
    await storeAdminSession(jti, row.id)
    return app.jwt.sign({ role: 'admin', adminRole: row.role, adminId: row.id, jti }, { expiresIn: '1h' })
  }
  const create = (body: unknown, t = token) => app.inject({ method: 'POST', url: '/api/admin/items', headers: { authorization: `Bearer ${t}` }, payload: body })

  beforeAll(async () => {
    await testPrisma.$connect()
    app = await buildApp()
    await app.ready()
    token = await admin('SUPER_ADMIN')
    moderatorToken = await admin('MODERATOR')
  })
  beforeEach(async () => { await cleanDatabase() })
  afterAll(async () => {
    await testPrisma.adminActionLog.deleteMany()
    await testPrisma.adminUser.deleteMany({ where: { username: { startsWith: 'items-' } } })
    await app.close()
    await testPrisma.$disconnect()
  })

  const boots = {
    name: 'Кирзачи', type: 'ARMOR', armorSlot: 'FEET', priceBase: 700, levelReq: 1, durabilityMax: 100, weight: 1.2,
    minDamage: null, maxDamage: null, weaponAccuracy: null, armor: 4, dodgeBonus: 0.02,
    statBudget: 3, allocationMode: 'PLAYER',
  }

  it('обувь со слотом, статами и в продаже у Коммерсанта: покупатель получает свободные очки', async () => {
    const res = await create({ item: boots, sale: { shop: 'kommersant', price: 650 }, reason: REASON })
    expect(res.statusCode).toBe(201)
    const { code } = res.json<{ code: string }>()
    expect(code).toMatch(/^armor_feet_/)
    const template = await testPrisma.itemTemplate.findUniqueOrThrow({ where: { code } })
    expect(template).toMatchObject({ armorSlot: 'FEET', statBudget: 3, allocationMode: 'PLAYER', sourceType: 'PRIVATE', isEquippable: true })

    const listed = (await PrivateShopsService.listItems('kommersant')).find(row => row.code === code)
    expect(listed).toMatchObject({ price: 650, levelReq: 1 })

    const login = uid('buyer')
    const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
    const buyer = await testPrisma.character.create({ data: { userId: user.id, nickname: login, archetype: 'STREET', hpCurrent: 80, hpMax: 80, money: 5_000, battleLevel: 2 } })
    const bought = await PrivateShopsService.buy(buyer.id, 'kommersant', listed!.id, 1, uid('k'))
    const item = await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: bought.itemIds[0] } })
    expect(item.freePoints).toBe(3)
  })

  it('оружие без вида, урон «от» больше «до» и лишние очки — отказ с понятной причиной', async () => {
    const knife = { name: 'Заточка', type: 'WEAPON', priceBase: 300, levelReq: 1, durabilityMax: 80, weight: 0.3, minDamage: 4, maxDamage: 8, weaponAccuracy: 0.8, armor: null }
    expect((await create({ item: knife, reason: REASON })).json()).toMatchObject({ message: expect.stringMatching(/вид/) })
    expect((await create({ item: { ...knife, weaponType: 'KNIFE', minDamage: 9 }, reason: REASON })).json()).toMatchObject({ message: expect.stringMatching(/больше/) })
    const overBudget = { ...knife, weaponType: 'KNIFE', statBudget: 3, allocationMode: 'FIXED', statAllocation: { DAMAGE: 2, CRIT: 2 } }
    expect((await create({ item: overBudget, reason: REASON })).json()).toMatchObject({ message: expect.stringMatching(/Расставлено 4/) })
    const wrongStat = { ...knife, weaponType: 'KNIFE', statBudget: 3, allocationMode: 'FIXED', statAllocation: { ARMOR: 1 } }
    expect((await create({ item: wrongStat, reason: REASON })).statusCode).toBe(422)
    const shirt = { ...boots, armorSlot: null }
    expect((await create({ item: shirt, reason: REASON })).json()).toMatchObject({ message: expect.stringMatching(/слот/) })
  })

  it('госмагазин и откат: вещь и витрина уходят вместе; модератору создавать нельзя', async () => {
    const knife = {
      name: 'Финка', type: 'WEAPON', weaponType: 'KNIFE', priceBase: 900, levelReq: 2, durabilityMax: 90, weight: 0.4,
      minDamage: 6, maxDamage: 11, weaponAccuracy: 0.8, maxRange: 1, armor: null,
      statBudget: 4, allocationMode: 'FIXED', statAllocation: { DAMAGE: 2, CRIT: 2 },
    }
    expect((await create({ item: knife, sale: { shop: 'GOVERNMENT', price: 900 }, reason: REASON }, moderatorToken)).statusCode).toBe(403)
    const res = await create({ item: knife, sale: { shop: 'GOVERNMENT', price: 900 }, reason: REASON })
    expect(res.statusCode).toBe(201)
    const { code, actionId } = res.json<{ code: string; actionId: string }>()
    const template = await testPrisma.itemTemplate.findUniqueOrThrow({ where: { code } })
    expect(template).toMatchObject({ weaponType: 'KNIFE', armorSlot: null, sourceType: 'GOVERNMENT', statAllocation: { DAMAGE: 2, CRIT: 2 } })
    expect(await testPrisma.governmentShopItem.count({ where: { templateId: template.id } })).toBe(1)

    const undone = await app.inject({ method: 'POST', url: `/api/admin/actions/${actionId}/rollback`, headers: { authorization: `Bearer ${token}` }, payload: { reason: 'ошиблись с ценой финки' } })
    expect(undone.statusCode).toBe(200)
    expect(await testPrisma.itemTemplate.count({ where: { code } })).toBe(0)
    expect(await testPrisma.governmentShopItem.count({ where: { templateId: template.id } })).toBe(0)
  })

  // Правка 26.10: «статы в шмоте — сила, выносливость, фарт, ловкость,
  // меткость, агрессия; обереги уворота, удачи, крита, ответа — в плюс и в минус».
  it('вещь с выносливостью и здоровьем поднимает максимум HP, снял — вернулось; обереги в минус сохраняются', async () => {
    const vest = {
      name: 'Бронежилет Витязь', type: 'ARMOR', armorSlot: 'CHEST', priceBase: 100, levelReq: 0, durabilityMax: 100, weight: 3,
      minDamage: null, maxDamage: null, weaponAccuracy: null, armor: 10, hpBonus: 10,
      statBonuses: { end: 5, agi: -1 }, antiDodge: -0.05, antiCrit: 0.1,
    }
    const res = await create({ item: vest, sale: { shop: 'kommersant', price: 100 }, reason: REASON })
    expect(res.statusCode).toBe(201)
    const { code } = res.json<{ code: string }>()
    const template = await testPrisma.itemTemplate.findUniqueOrThrow({ where: { code } })
    expect(template).toMatchObject({ statBonuses: { end: 5, agi: -1 }, antiDodge: -0.05, antiCrit: 0.1, hpBonus: 10 })

    const login = uid('vityaz')
    const password = 'local_test_pw_123'
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { acceptPolicy: true, login, email: `${login}@test.local`, password } })
    const { token: userToken } = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login, password } })).json<{ token: string }>()
    await app.inject({ method: 'POST', url: '/api/characters', headers: { authorization: `Bearer ${userToken}` }, payload: { nickname: 'Vit' + Math.random().toString(36).slice(2, 8), archetype: 'STREET' } })
    const character = await testPrisma.character.findFirstOrThrow({ where: { user: { login } } })
    await testPrisma.character.update({ where: { id: character.id }, data: { money: 5_000 } })
    const listed = (await PrivateShopsService.listItems('kommersant')).find(row => row.code === code)!
    const bought = await PrivateShopsService.buy(character.id, 'kommersant', listed.id, 1, uid('k'))
    const before = character.hpMax

    const wear = await app.inject({ method: 'POST', url: '/api/inventory/equip', headers: { authorization: `Bearer ${userToken}` }, payload: { itemInstanceId: bought.itemIds[0] } })
    expect(wear.statusCode).toBe(200)
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).hpMax).toBe(before + 5 * 6 + 10)

    const off = await app.inject({ method: 'POST', url: '/api/inventory/unequip', headers: { authorization: `Bearer ${userToken}` }, payload: { itemInstanceId: bought.itemIds[0] } })
    expect(off.statusCode).toBe(200)
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).hpMax).toBe(before)

    // Оберег за пределом ±200% и прибавка больше 50 — отказ.
    expect((await create({ item: { ...vest, name: 'Сломанный', antiDodge: -2.5 }, reason: REASON })).statusCode).toBe(422)
    expect((await create({ item: { ...vest, name: 'Сломанный', statBonuses: { str: 60 } }, reason: REASON })).statusCode).toBe(422)
  })
})
