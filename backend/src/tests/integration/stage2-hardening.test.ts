import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { cleanupExpiredIdempotencyKeys, withIdempotency } from '../../shared/db/idempotency'
import { WorkService } from '../../modules/work/work.service'
import { runWorkShiftFinalize } from '../../workers/work-shift-finalize.worker'
import { getRedis, disconnectRedis } from '../../shared/db/redis'

async function character() {
  const login = uid('hardening')
  const user = await testPrisma.user.create({
    data: { login, email: `${login}@test.local`, passwordHash: 'x' },
  })
  return testPrisma.character.create({
    data: {
      userId: user.id,
      nickname: login,
      archetype: 'WORKER',
      hpCurrent: 80,
      hpMax: 80,
      money: 100,
    },
  })
}

async function workFixture() {
  const worker = await character()
  const object = await testPrisma.productionObject.create({
    data: {
      code: uid('hardening_object'),
      name: 'Hardening workplace',
      type: 'SCRAPYARD',
      requiredProductionLevel: 0,
      shiftDurationMinutes: 30,
      baseSalary: 80,
      baseProductionExp: 10,
    },
  })
  return { worker, object }
}

describe('Stage 2 hardening', () => {
  beforeAll(async () => {
    await testPrisma.$connect()
    await getRedis().ping()
  })
  beforeEach(async () => {
    await cleanDatabase()
    await getRedis().flushdb()
  })
  afterAll(async () => {
    await testPrisma.$disconnect()
    await disconnectRedis()
  })

  it('commits one credit for concurrent requests with the same idempotency key', async () => {
    const owner = await character()
    const results = await Promise.all(
      Array.from({ length: 12 }, () => withIdempotency({
        characterId: owner.id,
        scope: 'hardening.concurrent',
        key: 'hardening-concurrent-key',
        execute: async tx => {
          await tx.character.update({
            where: { id: owner.id },
            data: { money: { increment: 25 } },
          })
          return { credited: 25 }
        },
      })),
    )

    expect(results.every(result => result.credited === 25)).toBe(true)
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: owner.id } })).money).toBe(125)
    expect(await testPrisma.idempotencyKey.count()).toBe(1)
  })

  it('does not replay an expired key and cleanup removes only expired keys', async () => {
    const owner = await character()
    await testPrisma.idempotencyKey.create({
      data: {
        characterId: owner.id,
        scope: 'hardening.expired',
        key: 'hardening-expired-key',
        responseJson: { value: 'stale' },
        expiresAt: new Date(Date.now() - 60_000),
      },
    })

    const result = await withIdempotency({
      characterId: owner.id,
      scope: 'hardening.expired',
      key: 'hardening-expired-key',
      execute: async () => ({ value: 'fresh' }),
    })
    expect(result).toEqual({ value: 'fresh' })

    await testPrisma.idempotencyKey.create({
      data: {
        characterId: owner.id,
        scope: 'hardening.cleanup',
        key: 'hardening-cleanup-key',
        responseJson: { ok: true },
        expiresAt: new Date(Date.now() - 1),
      },
    })
    expect(await cleanupExpiredIdempotencyKeys()).toBe(1)
    expect(await testPrisma.idempotencyKey.count()).toBe(1)
  })

  it('finalize is safe under duplicate workers', async () => {
    const { worker, object } = await workFixture()
    const started = await WorkService.start(worker.id, object.id)
    await testPrisma.workShift.update({
      where: { id: started.shift.id },
      data: { endsAt: new Date(Date.now() - 1000) },
    })

    const counts = await Promise.all([runWorkShiftFinalize(), runWorkShiftFinalize()])
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(1)
    expect(await testPrisma.productionLog.count({
      where: { characterId: worker.id, eventType: 'SHIFT_READY' },
    })).toBe(1)
  })

  it('claim never overwrites an active battle status', async () => {
    const { worker, object } = await workFixture()
    const started = await WorkService.start(worker.id, object.id)
    await testPrisma.workShift.update({
      where: { id: started.shift.id },
      data: { status: 'READY_TO_CLAIM', endsAt: new Date(Date.now() - 1000) },
    })
    await testPrisma.character.update({ where: { id: worker.id }, data: { status: 'IN_BATTLE' } })

    await expect(WorkService.claim(worker.id, started.shift.id, 'hardening-claim-busy')).rejects.toMatchObject({
      statusCode: 409,
    })
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: worker.id } })).status).toBe('IN_BATTLE')
    expect(await testPrisma.currencyLog.count({ where: { characterId: worker.id } })).toBe(0)
  })
})
