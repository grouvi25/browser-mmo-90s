import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { testPrisma } from './helpers'
import { disconnectRedis, getRedis } from '../../shared/db/redis'

describe('readiness route', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    await testPrisma.$connect()
    await getRedis().ping()
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await testPrisma.$disconnect()
    await disconnectRedis()
  })

  it('returns 200 with explicit PostgreSQL and Redis status', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      status: 'ready',
      checks: { postgres: 'ok', redis: 'ok' },
    })
  })
})
