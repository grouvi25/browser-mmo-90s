import { getRedis } from '../../shared/db/redis'
const MAX_SHIFTS = 8
const key = (characterId: string) => `work:${characterId}:shifts:${new Date().toISOString().slice(0,10).replace(/-/g,'')}`
export const WorkRedis = {
  async tryConsumeDailyShift(characterId: string): Promise<boolean> {
    const redis = getRedis(); const k = key(characterId); const count = await redis.incr(k)
    if (count === 1) await redis.expire(k, 90_000)
    if (count > MAX_SHIFTS) { await redis.decr(k); return false }
    return true
  },
  async refundDailyShift(characterId: string): Promise<void> {
    const redis = getRedis(); const k = key(characterId); const current = Number(await redis.get(k) ?? 0)
    if (current > 0) await redis.decr(k)
  },
  async getDailyShifts(characterId: string): Promise<number> { return Number(await getRedis().get(key(characterId)) ?? 0) },
  maxShifts: MAX_SHIFTS,
}
