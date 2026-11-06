/**
 * Обращение №44: «Купила рабочий набор, нажимаю надеть, пишет что нет в продаже».
 * Инструмент не надевается, но ответ был под кодом магазина SHOP_002,
 * и экран переводил его как «Товара нет в продаже».
 */
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app'
import { disconnectRedis, getRedis } from '../../shared/db/redis'
import { storeSession } from '../../shared/security/jwt'
import { cleanDatabase, testPrisma, uid } from './helpers'

let app: FastifyInstance
beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping(); app = await buildApp(); await app.ready() })
beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })
afterAll(async () => { await app.close(); await testPrisma.$disconnect(); await disconnectRedis() })

describe('надеть инструмент', () => {
  it('отказ с понятной причиной, а не «нет в продаже»', async () => {
    const login = uid('tool')
    const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
    const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'WORKER', hpCurrent: 80, hpMax: 80 } })
    await testPrisma.characterStats.create({ data: { characterId: character.id, str: 5, agi: 5, rea: 5, acc: 5, end: 5, luck: 5, agr: 5, auth: 5 } })
    const template = await testPrisma.itemTemplate.create({ data: { code: uid('kit'), name: 'Рабочий набор', type: 'TOOL', toolTier: 1, usesMax: 20, weight: 1, durabilityMax: 1, priceBase: 500, isEquippable: false } })
    const tool = await testPrisma.itemInstance.create({ data: { templateId: template.id, ownerId: character.id, durabilityCurrent: 1, durabilityMax: 1, weight: 1, sourceType: 'GOVERNMENT', usesLeft: 20 } })
    const jti = randomUUID()
    await storeSession(jti, user.id)
    const res = await app.inject({
      method: 'POST', url: '/api/inventory/equip',
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: user.id, jti })}` },
      payload: { itemInstanceId: tool.id },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'ITEM_006', message: 'Инструмент не надевают: смена берёт его со склада сама' })
  })
})
