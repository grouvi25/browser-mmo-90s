import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { gearOf } from '../../modules/items/gear-bonuses'
import { storeSession } from '../../shared/security/jwt'
import { cleanDatabase, testPrisma, uid } from './helpers'

let app: FastifyInstance
beforeAll(async () => { await testPrisma.$connect(); app = await buildApp(); await app.ready() })
beforeEach(async () => cleanDatabase())
afterAll(async () => { await app.close(); await testPrisma.$disconnect() })

async function fixture() {
  const login = uid('ring')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'WORKER', hpCurrent: 80, hpMax: 80 } })
  await testPrisma.characterStats.create({ data: { characterId: character.id } })
  const template = await testPrisma.itemTemplate.create({
    data: { code: uid('ring'), name: 'Кольцо', type: 'ACCESSORY', armorSlot: 'RING', isEquippable: true, statBonuses: { str: 2 }, sourceType: 'ADMIN' },
  })
  const ring = () => testPrisma.itemInstance.create({
    data: { templateId: template.id, ownerId: character.id, quality: 'COMMON', durabilityCurrent: 100, durabilityMax: 100, weight: 0.1, sourceType: 'ADMIN' },
  })
  const jti = randomUUID()
  await storeSession(jti, user.id)
  const headers = { authorization: `Bearer ${app.jwt.sign({ sub: user.id, jti })}` }
  const equip = (id: string) => app.inject({ method: 'POST', url: '/api/inventory/equip', headers, payload: { itemInstanceId: id } })
  return { character, ring, equip }
}

const slotOf = async (id: string) => (await testPrisma.itemInstance.findUniqueOrThrow({ where: { id } })).armorSlot

describe('Кольца', () => {
  it('носятся два сразу, третье меняет первое, оба дают прибавку', async () => {
    const { character, ring, equip } = await fixture()
    const [first, second, third] = [await ring(), await ring(), await ring()]
    expect((await equip(first.id)).statusCode).toBe(200)
    expect((await equip(second.id)).statusCode).toBe(200)
    expect(await slotOf(first.id)).toBe('RING')
    expect(await slotOf(second.id)).toBe('RING_2')

    const worn = await testPrisma.itemInstance.findMany({ where: { ownerId: character.id, isEquipped: true }, include: { template: true } })
    expect(gearOf(worn).stats.str).toBe(4)

    expect((await equip(third.id)).statusCode).toBe(200)
    expect(await slotOf(third.id)).toBe('RING')
    expect((await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: first.id } })).isEquipped).toBe(false)
    expect(await slotOf(second.id)).toBe('RING_2')
  })
})
