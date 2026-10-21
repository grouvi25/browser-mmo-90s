import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { BalanceConfig } from '../../config/balance.config'
import { CharactersService } from '../../modules/characters/characters.service'
import { AuthService } from '../../modules/auth/auth.service'
import { disconnectRedis } from '../../shared/db/redis'
import { cleanDatabase, testPrisma, uid } from './helpers'

describe('character creation configuration', () => {
  let app: FastifyInstance
  beforeAll(async () => { await testPrisma.$connect(); app = await buildApp(); await app.ready() })
  beforeEach(cleanDatabase)
  afterAll(async () => { await app.close(); await testPrisma.$disconnect(); await disconnectRedis() })

  it('requires login but does not require an existing character', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/characters/creation-config' })).statusCode).toBe(401)
    const login = uid('config')
    await AuthService.register({ login, email: `${login}@test.local`, password: 'test-password' })
    const auth = await AuthService.login({ login, password: 'test-password' })
    const response = await app.inject({ method: 'GET', url: '/api/characters/creation-config', headers: { authorization: `Bearer ${app.jwt.sign({ sub: auth.userId, jti: auth.jti })}` } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ startMoney: BalanceConfig.character.startMoney })
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('reads runtime overrides, and creation grants exactly the displayed amount', async () => {
    const original = BalanceConfig.character.startMoney
    const login = uid('balance')
    const user = await AuthService.register({ login, email: `${login}@test.local`, password: 'test-password' })
    const auth = await AuthService.login({ login, password: 'test-password' })
    try {
      BalanceConfig.character.startMoney = 25000
      const response = await app.inject({ method: 'GET', url: '/api/characters/creation-config', headers: { authorization: `Bearer ${app.jwt.sign({ sub: auth.userId, jti: auth.jti })}` } })
      expect(response.json()).toEqual({ startMoney: 25000 })
      const character = await CharactersService.create(user.id, { nickname: uid('Money'), archetype: 'MERCHANT' })
      expect(character?.money).toBe(response.json().startMoney)
      BalanceConfig.character.startMoney = 1250
      const updated = await app.inject({ method: 'GET', url: '/api/characters/creation-config', headers: { authorization: `Bearer ${app.jwt.sign({ sub: auth.userId, jti: auth.jti })}` } })
      expect(updated.json()).toEqual({ startMoney: 1250 })
    } finally { BalanceConfig.character.startMoney = original }
  })
})
