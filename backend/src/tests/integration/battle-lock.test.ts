import { afterAll, describe, expect, it } from 'vitest'
import { BattleRedis, disconnectRedis, getRedis } from '../../shared/db/redis'
import { BATTLE_LOCK_TTL_MS } from '../../modules/battles/battles.service'

describe('battle distributed lock', () => {
  afterAll(async () => {
    await disconnectRedis()
  })

  it('uses a TTL larger than the transaction timeout budget', () => {
    expect(BATTLE_LOCK_TTL_MS).toBeGreaterThanOrEqual(15_000)
  })

  it('extends and releases only a token-owned lock', async () => {
    const battleId = `lock-test-${Date.now()}`
    const token = await BattleRedis.acquireLock(battleId, 1_000)
    expect(token).toBeTruthy()

    expect(await BattleRedis.extendLock(battleId, 'wrong-token', 15_000)).toBe(false)
    expect(await BattleRedis.extendLock(battleId, token!, 15_000)).toBe(true)
    expect(await getRedis().pttl(BattleRedis.lockKey(battleId))).toBeGreaterThan(10_000)

    await BattleRedis.releaseLock(battleId, 'wrong-token')
    expect(await getRedis().exists(BattleRedis.lockKey(battleId))).toBe(1)
    await BattleRedis.releaseLock(battleId, token!)
    expect(await getRedis().exists(BattleRedis.lockKey(battleId))).toBe(0)
  })
})
