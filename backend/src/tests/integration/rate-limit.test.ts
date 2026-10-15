/**
 * Лимит частоты запросов. Ответ лимита собирался без кода статуса и уходил
 * в общий обработчик как неизвестная ошибка: игрок видел «Internal server
 * error» (500) вместо просьбы подождать. Проверяем, что это 429 и по-русски.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { getRedis } from '../../shared/db/redis'

describe('лимит частоты запросов', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    await getRedis().flushdb()
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
    await getRedis().flushdb()
  })

  it('сверх лимита отвечает 429 с понятным текстом, а не 500', async () => {
    let last = { statusCode: 0, body: '' }
    for (let i = 0; i < 25; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'nobody', password: 'wrong-password' } })
      last = { statusCode: res.statusCode, body: res.body }
      if (res.statusCode === 429) break
    }
    expect(last.statusCode).toBe(429)
    expect(JSON.parse(last.body)).toMatchObject({ code: 'GEN_004', message: 'Слишком много запросов, подождите немного' })
  })
})
