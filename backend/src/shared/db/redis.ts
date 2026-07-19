import Redis from 'ioredis'
import { env } from '../../config/env'

let _redis: Redis | null = null
let _redisSub: Redis | null = null

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    })
    _redis.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message)
    })
  }
  return _redis
}

/** Separate subscriber client for Socket.io Redis adapter */
export function getRedisSub(): Redis {
  if (!_redisSub) {
    _redisSub = getRedis().duplicate()
  }
  return _redisSub
}

export async function disconnectRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit()
    _redis = null
  }
  if (_redisSub) {
    await _redisSub.quit()
    _redisSub = null
  }
}

// ----------------------------------------------------------------
// Battle state helpers — stored in Redis, NOT in PostgreSQL
// ----------------------------------------------------------------

const BATTLE_STATE_TTL = 60 * 60 * 2 // 2 hours max battle duration

export const BattleRedis = {
  stateKey:    (id: string) => `battle:${id}:state`,
  lockKey:     (id: string) => `battle:${id}:lock`,
  actionsKey:  (id: string) => `battle:${id}:actions`,
  timerKey:    (id: string) => `battle:${id}:timer`,

  async setState(id: string, state: object): Promise<void> {
    await getRedis().setex(
      BattleRedis.stateKey(id),
      BATTLE_STATE_TTL,
      JSON.stringify(state)
    )
  },

  async getState<T>(id: string): Promise<T | null> {
    const raw = await getRedis().get(BattleRedis.stateKey(id))
    return raw ? JSON.parse(raw) : null
  },

  async deleteState(id: string): Promise<void> {
    await getRedis().del(
      BattleRedis.stateKey(id),
      BattleRedis.lockKey(id),
      BattleRedis.actionsKey(id),
      BattleRedis.timerKey(id),
    )
  },

  /** Acquire distributed lock. Returns true if acquired. */
  async acquireLock(id: string, ttlMs = 10_000): Promise<boolean> {
    const result = await getRedis().set(
      BattleRedis.lockKey(id),
      '1',
      'PX', ttlMs,
      'NX'
    )
    return result === 'OK'
  },

  async releaseLock(id: string): Promise<void> {
    await getRedis().del(BattleRedis.lockKey(id))
  },
}

// ----------------------------------------------------------------
// Session helpers
// ----------------------------------------------------------------
const SESSION_PREFIX = 'session:'

export const SessionRedis = {
  async set(jti: string, userId: string, ttlSeconds: number): Promise<void> {
    await getRedis().setex(`${SESSION_PREFIX}${jti}`, ttlSeconds, userId)
  },

  async get(jti: string): Promise<string | null> {
    return getRedis().get(`${SESSION_PREFIX}${jti}`)
  },

  async revoke(jti: string): Promise<void> {
    await getRedis().del(`${SESSION_PREFIX}${jti}`)
  },

  async revokeAll(userId: string, jtis: string[]): Promise<void> {
    if (jtis.length === 0) return
    const keys = jtis.map(j => `${SESSION_PREFIX}${j}`)
    await getRedis().del(...keys)
  },
}

// ----------------------------------------------------------------
// Online status helpers
// ----------------------------------------------------------------
const ONLINE_TTL = 300 // 5 min

export const OnlineRedis = {
  async setOnline(charId: string, status: string = 'active'): Promise<void> {
    await getRedis().setex(`char:${charId}:status`, ONLINE_TTL, status)
  },

  async isOnline(charId: string): Promise<boolean> {
    return (await getRedis().exists(`char:${charId}:status`)) > 0
  },

  async getStatus(charId: string): Promise<string | null> {
    return getRedis().get(`char:${charId}:status`)
  },

  async setStatus(charId: string, status: string): Promise<void> {
    await getRedis().setex(`char:${charId}:status`, ONLINE_TTL * 12, status)
  },

  async clearStatus(charId: string): Promise<void> {
    await getRedis().del(`char:${charId}:status`)
  },
}
