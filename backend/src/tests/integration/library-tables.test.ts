/**
 * Библиотека собирается из объектов и вещей игры, а не из текста: новые профессии,
 * цехи и эффекты расходников появляются в ней сами (5.11 она отставала от игры).
 */
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app'
import { storeSession } from '../../shared/security/jwt'
import { cleanDatabase, testPrisma, uid } from './helpers'

let app: FastifyInstance
beforeAll(async () => { await testPrisma.$connect(); app = await buildApp(); await app.ready() })
beforeEach(async () => cleanDatabase())
afterAll(async () => { await app.close(); await testPrisma.$disconnect() })

async function headers() {
  const login = uid('lib')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const jti = randomUUID()
  await storeSession(jti, user.id)
  return { authorization: `Bearer ${app.jwt.sign({ sub: user.id, jti })}` }
}

describe('Библиотека', () => {
  it('ремесло показывает добычу, цех на продаже, инструмент и расходник с эффектом', async () => {
    const ore = await testPrisma.resourceTemplate.create({ data: { code: uid('ore'), name: 'Руда', category: 'PRIMARY', basePrice: 1 } })
    await testPrisma.productionObject.create({ data: {
      code: uid('mine'), name: 'Рудник', type: 'SCRAPYARD', locationId: 'industrial', requiredProfessionCode: 'metallurgist',
      shiftDurationMinutes: 50, baseSalary: 0, baseProductionExp: 10, producesResourceCode: ore.code, outputAmountMin: 1, outputAmountMax: 1,
    } })
    const shop = await testPrisma.productionObject.create({ data: {
      code: uid('lab'), name: 'Лаборатория', type: 'WORKSHOP', locationId: 'industrial', requiredProfessionCode: 'alchemist',
      shiftDurationMinutes: 60, baseSalary: 0, baseProductionExp: 20, isForSale: true,
    } })
    const potion = await testPrisma.itemTemplate.create({ data: {
      code: uid('pot'), name: 'Настойка силы', type: 'CONSUMABLE', weight: 0, durabilityMax: 1, priceBase: 10,
      useEffect: { buffs: [{ stat: 'damage', value: 0.1 }], minutes: 10 },
    } })
    await testPrisma.productionRecipe.create({ data: {
      code: uid('rcp'), name: 'Настойка силы', productionObjectCode: shop.code, outputItemTemplateCode: potion.code, outputAmount: 1,
      cycleMinutes: 1, laborRequired: 60, requiredProfessionCode: 'alchemist', requiredProfessionLevel: 0, requiredToolTier: 1,
    } })

    const res = await app.inject({ method: 'GET', url: '/api/library/tables', headers: await headers() })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      professions: Array<{ chain: string; steps: Array<{ code: string; objects: Array<Record<string, unknown>> }> }>
      consumables: Array<Record<string, unknown>>
    }
    const steps = body.professions.flatMap(chain => chain.steps)
    expect(steps).toHaveLength(17)
    expect(steps.find(s => s.code === 'metallurgist')?.objects[0]).toMatchObject({ name: 'Рудник', gives: 'Руда', salary: 0, forSaleUsd: null })
    expect(steps.find(s => s.code === 'alchemist')?.objects[0]).toMatchObject({ name: 'Лаборатория', gives: 'Настойка силы', forSaleUsd: 15000 })
    expect(body.consumables).toContainEqual({ name: 'Настойка силы', does: 'урон +10% на 10 мин', where: 'где угодно', madeAt: 'Лаборатория' })
  })
})
