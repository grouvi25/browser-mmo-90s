/**
 * ЦУМ и Берёзка из админки (правка 30.10: «не понятно, как добавлять в
 * Берёзку и в ЦУМ»). Вещь из формы сразу на витрине за доллары, цену и
 * продажу правят из справочника, всё откатывается из журнала.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { hashPassword } from '../../shared/security/password'
import { generateJti, storeAdminSession } from '../../shared/security/jwt'
import { CityService } from '../../modules/city/city.service'
import { seedCity } from '../../../prisma/seed-city'
import { cleanDatabase, testPrisma, uid } from './helpers'

const REASON = 'новая донатная вещь по документу'

describe('ЦУМ и Берёзка из админки', () => {
  let app: FastifyInstance
  let token = ''
  const auth = () => ({ authorization: `Bearer ${token}` })

  beforeAll(async () => {
    await testPrisma.$connect()
    app = await buildApp()
    await app.ready()
    const row = await testPrisma.adminUser.create({ data: { username: uid('dshop'), passwordHash: await hashPassword('x'), role: 'SUPER_ADMIN' } })
    const jti = generateJti()
    await storeAdminSession(jti, row.id)
    token = app.jwt.sign({ role: 'admin', adminRole: row.role, adminId: row.id, jti }, { expiresIn: '1h' })
  })
  beforeEach(async () => { await cleanDatabase(); await seedCity(testPrisma) })
  afterAll(async () => {
    await testPrisma.adminActionLog.deleteMany()
    await testPrisma.adminUser.deleteMany({ where: { username: { startsWith: 'dshop' } } })
    await app.close()
    await testPrisma.$disconnect()
  })

  it('стартовые товары на витринах по прежним ценам; повторный сид цену не трогает', async () => {
    const tsum = await CityService.catalog('tsum')
    expect(tsum.items.map(i => [i.code, i.priceDollars])).toEqual([['tsum_named_knife', 20], ['tsum_named_jacket', 25]])
    expect((await CityService.catalog('berezka')).items.map(i => i.priceDollars)).toEqual([30])

    const knife = await testPrisma.itemTemplate.findUniqueOrThrow({ where: { code: 'tsum_named_knife' } })
    await testPrisma.dollarShopItem.update({ where: { shop_templateId: { shop: 'TSUM', templateId: knife.id } }, data: { priceDollars: 18 } })
    await seedCity(testPrisma)
    expect((await CityService.catalog('tsum')).items[0].priceDollars).toBe(18)
  })

  it('новая вещь сразу в ЦУМе за доллары; покупка по цене витрины', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/items', headers: auth(),
      payload: {
        item: { name: 'Именная кепка', type: 'ARMOR', armorSlot: 'HEAD', priceBase: 9000, levelReq: 1, durabilityMax: 100, weight: 0.3, armor: 4, minDamage: null, maxDamage: null, weaponAccuracy: null, statBudget: 6, allocationMode: 'PLAYER' },
        sale: { shop: 'TSUM', price: 15 }, reason: REASON,
      },
    })
    expect(res.statusCode).toBe(201)
    const { code } = res.json<{ code: string }>()
    const template = await testPrisma.itemTemplate.findUniqueOrThrow({ where: { code } })
    expect(template.sourceType).toBe('DONATE')
    const listed = (await CityService.catalog('tsum')).items.find(i => i.code === code)
    expect(listed?.priceDollars).toBe(15)

    const login = uid('buyer')
    const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
    const buyer = await testPrisma.character.create({ data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'STREET', hpCurrent: 100, hpMax: 100, dollars: 100 } })
    const bought = await CityService.buyItem(buyer.id, 'tsum', template.id, randomUUID())
    expect(bought).toMatchObject({ priceDollars: 15, dollars: 85 })
    expect(bought.item.freePoints).toBe(6)
    // В Берёзке этой вещи нет.
    await expect(CityService.buyItem(buyer.id, 'berezka', template.id, randomUUID())).rejects.toThrow()
  })

  it('снять с продажи и откатить; выставить существующую вещь в Берёзку', async () => {
    const off = await app.inject({ method: 'PUT', url: '/api/admin/catalog/dollar-shops/TSUM/tsum_named_knife', headers: auth(), payload: { fields: { isAvailable: false }, reason: 'нож временно снимаем' } })
    expect(off.statusCode).toBe(200)
    expect((await CityService.catalog('tsum')).items.map(i => i.code)).toEqual(['tsum_named_jacket'])

    const rollback = await app.inject({ method: 'POST', url: `/api/admin/actions/${off.json().actionId}/rollback`, headers: auth(), payload: { reason: 'вернуть нож в продажу' } })
    expect(rollback.statusCode).toBe(200)
    expect((await CityService.catalog('tsum')).items.map(i => i.code)).toContain('tsum_named_knife')

    const put = await app.inject({ method: 'PUT', url: '/api/admin/catalog/dollar-shops/BEREZKA/tsum_named_knife', headers: auth(), payload: { fields: { priceDollars: 40 }, reason: 'нож и в Берёзку тоже' } })
    expect(put.statusCode).toBe(200)
    expect((await CityService.catalog('berezka')).items.find(i => i.code === 'tsum_named_knife')?.priceDollars).toBe(40)
    const list = await app.inject({ url: '/api/admin/catalog/dollar-shops', headers: auth() })
    expect(list.json().items).toHaveLength(4)

    const missing = await app.inject({ method: 'PUT', url: '/api/admin/catalog/dollar-shops/TSUM/no_such_item', headers: auth(), payload: { fields: { priceDollars: 5 }, reason: 'нет такой вещи тест' } })
    expect(missing.statusCode).toBe(404)
  })
})
