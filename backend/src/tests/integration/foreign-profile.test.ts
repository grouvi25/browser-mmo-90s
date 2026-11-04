/**
 * Чужое личное дело (обращение №18): образ надетой вещи и подписка видны другим игрокам.
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

async function player(prefix: string, data: Record<string, unknown> = {}) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'STREET', hpCurrent: 80, hpMax: 80, ...data } })
  const jti = randomUUID()
  await storeSession(jti, user.id)
  return { character, headers: { authorization: `Bearer ${app.jwt.sign({ sub: user.id, jti })}` } }
}

const look = async (viewer: { headers: Record<string, string> }, nickname: string) =>
  (await app.inject({ method: 'GET', url: `/api/characters/by-nickname/${encodeURIComponent(nickname)}`, headers: viewer.headers })).json()

describe('Чужое личное дело', () => {
  it('отдаёт образ надетого оружия', async () => {
    const owner = await player('own')
    const viewer = await player('view')
    const template = await testPrisma.itemTemplate.create({
      data: { code: uid('nm'), name: 'Именной нож', type: 'WEAPON', weaponType: 'KNIFE', isEquippable: true, sourceType: 'ADMIN' },
    })
    const item = await testPrisma.itemInstance.create({
      data: { templateId: template.id, ownerId: owner.character.id, quality: 'COMMON', durabilityCurrent: 100, durabilityMax: 100, weight: 1, sourceType: 'ADMIN', isEquipped: true, status: 'EQUIPPED', armorSlot: 'RIGHT_HAND', iconVersion: 3 },
    })
    const body = await look(viewer, owner.character.nickname)
    expect(body.weapons).toEqual([expect.objectContaining({ id: item.id, iconVersion: 3, armorSlot: 'RIGHT_HAND' })])
  })

  it('показывает подписку, пока она действует', async () => {
    const viewer = await player('view')
    const active = await player('prem', { isPremium: true, premiumExpiresAt: new Date(Date.now() + 86_400_000) })
    const expired = await player('old', { isPremium: true, premiumExpiresAt: new Date(Date.now() - 86_400_000) })
    const plain = await player('free')
    expect((await look(viewer, active.character.nickname)).isPremium).toBe(true)
    expect((await look(viewer, expired.character.nickname)).isPremium).toBe(false)
    expect((await look(viewer, plain.character.nickname)).isPremium).toBe(false)
  })
})
