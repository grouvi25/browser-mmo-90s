import { describe, expect, it } from 'vitest'
import { checkReadiness } from '../../shared/health/readiness'

describe('readiness checks', () => {
  it('reports ready only when PostgreSQL and Redis both respond', async () => {
    const result = await checkReadiness(
      async () => 1,
      async () => 'PONG',
    )

    expect(result.status).toBe('ready')
    expect(result.checks).toEqual({ postgres: 'ok', redis: 'ok' })
    expect(Number.isNaN(Date.parse(result.ts))).toBe(false)
  })

  it.each([
    ['PostgreSQL', async () => { throw new Error('postgres down') }, async () => 'PONG', { postgres: 'error', redis: 'ok' }],
    ['Redis', async () => 1, async () => { throw new Error('redis down') }, { postgres: 'ok', redis: 'error' }],
    ['both dependencies', async () => { throw new Error('postgres down') }, async () => { throw new Error('redis down') }, { postgres: 'error', redis: 'error' }],
  ])('reports not_ready when %s fails', async (_name, postgresCheck, redisCheck, checks) => {
    const result = await checkReadiness(postgresCheck, redisCheck)

    expect(result.status).toBe('not_ready')
    expect(result.checks).toEqual(checks)
  })
})
