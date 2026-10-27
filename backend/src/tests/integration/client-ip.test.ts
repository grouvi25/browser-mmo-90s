/**
 * Адрес клиента для пределов по IP (28.10). Раньше сервер верил любому
 * X-Forwarded-For: подставив свой, бот получал новый «адрес» на каждый
 * запрос и обнулял пределы регистрации, входа и подбора пароля.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { getRedis, disconnectRedis } from '../../shared/db/redis'

const remaining = (res: { headers: Record<string, unknown> }) => Number(res.headers['x-ratelimit-remaining'])

describe('адрес клиента', () => {
  let app: FastifyInstance
  beforeAll(async () => { await getRedis().flushdb(); app = await buildApp(); await app.ready() })
  afterAll(async () => { await app.close(); await disconnectRedis() })

  it('подставной X-Forwarded-For от внешнего клиента не меняет адрес', async () => {
    const hit = (xff: string) => app.inject({ method: 'GET', url: '/api/auth/config', remoteAddress: '203.0.113.5', headers: { 'x-forwarded-for': xff } })
    const first = remaining(await hit('1.1.1.1'))
    const second = remaining(await hit('2.2.2.2'))
    const third = remaining(await hit('3.3.3.3'))
    // Один и тот же счётчик: каждый запрос его уменьшает.
    expect(second).toBe(first - 1)
    expect(third).toBe(first - 2)
  })

  it('за своим прокси (nginx, докер) берётся адрес, который он передал', async () => {
    const viaProxy = (client: string) => app.inject({ method: 'GET', url: '/api/auth/config', remoteAddress: '172.18.0.1', headers: { 'x-forwarded-for': client } })
    const a1 = remaining(await viaProxy('198.51.100.1'))
    const b1 = remaining(await viaProxy('198.51.100.2'))
    const a2 = remaining(await viaProxy('198.51.100.1'))
    // У разных игроков — свои счётчики.
    expect(b1).toBe(a1)
    expect(a2).toBe(a1 - 1)
  })
})
