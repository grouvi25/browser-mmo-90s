import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { cleanDatabase, testPrisma, uid } from './helpers'

describe('character stat distribution concurrency', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    await testPrisma.$connect()
    app = await buildApp()
    await app.ready()
  })

  beforeEach(cleanDatabase)

  afterAll(async () => {
    await app.close()
    await testPrisma.$disconnect()
  })

  it('cannot spend the same point twice under concurrent requests', async () => {
    const login = uid('race')
    await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { login, email: `${login}@test.com`, password: 'password123' },
    })
    const loginResponse = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { login, password: 'password123' },
    })
    const token = loginResponse.json<{ token: string }>().token
    const auth = { authorization: `Bearer ${token}` }

    await app.inject({
      method: 'POST', url: '/api/characters/', headers: auth,
      payload: { nickname: uid('Racer'), archetype: 'STUDENT' },
    })
    const character = await testPrisma.character.findUniqueOrThrow({ where: { userId: loginResponse.json<{ userId: string }>().userId }, include: { stats: true } })
    await testPrisma.characterStats.update({
      where: { characterId: character.id }, data: { pointsAvailable: 1 },
    })
    const strBefore = character.stats!.str

    const responses = await Promise.all([
      app.inject({ method: 'POST', url: '/api/characters/stats/distribute', headers: auth, payload: { stat: 'str', amount: 1 } }),
      app.inject({ method: 'POST', url: '/api/characters/stats/distribute', headers: auth, payload: { stat: 'str', amount: 1 } }),
    ])

    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409])
    const stats = await testPrisma.characterStats.findUniqueOrThrow({ where: { characterId: character.id } })
    expect(stats.pointsAvailable).toBe(0)
    expect(stats.str).toBe(strBefore + 1)
  })
})
