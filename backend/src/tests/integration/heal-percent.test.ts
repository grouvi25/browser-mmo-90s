/**
 * Аптечка процентом на настоящем запросе (заказчик 4.11) и защита настойки без
 * эффекта: она не должна сгорать впустую, пока её действие не сделано.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { storeSession } from '../../shared/security/jwt'
import { cleanDatabase, testPrisma, uid } from './helpers'

let app: FastifyInstance
beforeAll(async () => { await testPrisma.$connect(); app = await buildApp(); await app.ready() })
beforeEach(async () => cleanDatabase())
afterAll(async () => { await app.close(); await testPrisma.$disconnect() })

async function fixture(hpCurrent: number, hpMax: number) {
  const login = uid('heal')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'STREET', hpCurrent, hpMax } })
  await testPrisma.characterStats.create({ data: { characterId: character.id } })
  const jti = randomUUID()
  await storeSession(jti, user.id)
  const headers = { authorization: `Bearer ${app.jwt.sign({ sub: user.id, jti })}` }
  const item = async (data: { healPercent?: number; hpBonus?: number }) => {
    const template = await testPrisma.itemTemplate.create({ data: { code: uid('kit'), name: 'Аптечка', type: 'CONSUMABLE', sourceType: 'CRAFTED', ...data } })
    return testPrisma.itemInstance.create({ data: { templateId: template.id, ownerId: character.id, quality: 'COMMON', durabilityCurrent: 1, durabilityMax: 1, weight: 0.1, sourceType: 'CRAFTED' } })
  }
  const use = (id: string) => app.inject({ method: 'POST', url: '/api/inventory/use-item', headers, payload: { itemInstanceId: id } })
  return { character, item, use }
}

describe('Аптечка процентом', () => {
  it('25% от максимума, а не старое число в единицах', async () => {
    const { item, use } = await fixture(40, 200)
    const res = await use((await item({ healPercent: 25, hpBonus: 5 })).id)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ hpRestored: 50, newHp: 90 })
  })

  it('100% лечит до максимума и не выше', async () => {
    const { item, use } = await fixture(10, 92)
    expect((await use((await item({ healPercent: 100 })).id)).json()).toMatchObject({ hpRestored: 82, newHp: 92 })
  })

  it('расходник с единицами работает как раньше', async () => {
    const { item, use } = await fixture(10, 92)
    expect((await use((await item({ hpBonus: 30 })).id)).json()).toMatchObject({ hpRestored: 30, newHp: 40 })
  })

  it('настойка без действия остаётся у игрока', async () => {
    const { item, use } = await fixture(10, 92)
    const potion = await item({})
    expect((await use(potion.id)).statusCode).toBe(409)
    expect((await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: potion.id } })).status).not.toBe('DELETED')
  })
})
