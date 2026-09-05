import { randomUUID } from 'crypto'
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

  /** Acquire a token-owned distributed lock. Returns the token when acquired. */
  async acquireLock(id: string, ttlMs = 10_000): Promise<string | null> {
    const token = randomUUID()
    const result = await getRedis().set(
      BattleRedis.lockKey(id),
      token,
      'PX', ttlMs,
      'NX'
    )
    return result === 'OK' ? token : null
  },

  async extendLock(id: string, token: string, ttlMs: number): Promise<boolean> {
    const script = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('pexpire', KEYS[1], ARGV[2])
      end
      return 0
    `
    const result = await getRedis().eval(
      script, 1, BattleRedis.lockKey(id), token, String(ttlMs)
    )
    return result === 1
  },

  async releaseLock(id: string, token: string): Promise<void> {
    const script = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
      end
      return 0
    `
    await getRedis().eval(script, 1, BattleRedis.lockKey(id), token)
  },
}

// ----------------------------------------------------------------
// Anti-farm helpers — track daily PvE bot kill count per character
// ТЗ раздел 27.3: pveExpCoeff = max(0.1, 1 - botKillsToday × 0.05)
// ----------------------------------------------------------------
const PVE_ANTIFARM_KEY = (charId: string) =>
  `char:${charId}:pve_today:${new Date().toISOString().slice(0, 10)}`

export const AntiFarmRedis = {
  async incrementPveKills(charId: string): Promise<number> {
    const key  = PVE_ANTIFARM_KEY(charId)
    const redis = getRedis()
    const count = await redis.incr(key)
    // Expire at end of day (UTC midnight + buffer)
    if (count === 1) await redis.expire(key, 90_000) // ~25 hours
    return count
  },

  async getPveKills(charId: string): Promise<number> {
    const raw = await getRedis().get(PVE_ANTIFARM_KEY(charId))
    return raw ? parseInt(raw, 10) : 0
  },

  /** ТЗ formula: pveExpCoeff = max(0.1, 1 - botKillsToday × 0.05) */
  calcPveAntiFarmCoeff(dailyKills: number): number {
    return Math.max(0.1, 1 - dailyKills * 0.05)
  },
}
const SESSION_PREFIX = 'session:'
const USER_SESSIONS_PREFIX = 'user:sessions:'

export const SessionRedis = {
  async set(jti: string, userId: string, ttlSeconds: number): Promise<void> {
    const redis = getRedis()
    await redis.setex(`${SESSION_PREFIX}${jti}`, ttlSeconds, userId)
    // Track jti in user's session set (for single-device enforcement)
    await redis.sadd(`${USER_SESSIONS_PREFIX}${userId}`, jti)
    await redis.expire(`${USER_SESSIONS_PREFIX}${userId}`, ttlSeconds + 60)
  },

  async get(jti: string): Promise<string | null> {
    return getRedis().get(`${SESSION_PREFIX}${jti}`)
  },

  async revoke(jti: string): Promise<void> {
    const userId = await getRedis().get(`${SESSION_PREFIX}${jti}`)
    await getRedis().del(`${SESSION_PREFIX}${jti}`)
    if (userId) {
      await getRedis().srem(`${USER_SESSIONS_PREFIX}${userId}`, jti)
    }
  },

  /** Revoke ALL sessions for a user — used for single-device login */
  async revokeAllForUser(userId: string): Promise<void> {
    const redis = getRedis()
    const jtis = await redis.smembers(`${USER_SESSIONS_PREFIX}${userId}`)
    if (jtis.length > 0) {
      const keys = jtis.map(j => `${SESSION_PREFIX}${j}`)
      await redis.del(...keys)
    }
    await redis.del(`${USER_SESSIONS_PREFIX}${userId}`)
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

// =============================================================
// Чат: присутствие и антифлуд.
//
// Присутствие держим отсортированным множеством, а не набором ключей
// с TTL: список онлайна нужно ЧИТАТЬ целиком, а перебирать ключи по
// маске в живой базе нельзя. Оценка — время последнего касания, так
// что подвисшие записи отсеиваются по ней же, даже если процесс упал
// и «ушёл» никто не отправил.
// =============================================================
const CHAT_PRESENCE_KEY = 'chat:online'

export const ChatRedis = {
  /** Игрок вошёл в эфир или подтвердил, что ещё здесь. */
  async presenceTouch(charId: string): Promise<void> {
    await getRedis().zadd(CHAT_PRESENCE_KEY, Date.now(), charId)
  },

  async presenceLeave(charId: string): Promise<void> {
    await getRedis().zrem(CHAT_PRESENCE_KEY, charId)
  },

  /**
   * Кто в эфире. Заодно подчищает протухшие записи — отдельная
   * уборка не нужна, а список читают часто.
   */
  async presenceList(ttlSeconds: number, limit: number): Promise<string[]> {
    const redis = getRedis()
    const edge = Date.now() - ttlSeconds * 1000
    await redis.zremrangebyscore(CHAT_PRESENCE_KEY, '-inf', edge)
    // Свежие сверху: кто коснулся позже, тот и первый в списке.
    return redis.zrevrange(CHAT_PRESENCE_KEY, 0, Math.max(0, limit - 1))
  },

  /** Когда игрок писал в прошлый раз, мс эпохи, или null. */
  async lastSpokeAt(key: string): Promise<number | null> {
    const raw = await getRedis().get(key)
    return raw ? parseInt(raw, 10) : null
  },

  async markSpokeAt(key: string, at: number, ttlSeconds: number): Promise<void> {
    await getRedis().setex(key, ttlSeconds, String(at))
  },

  /**
   * Счётчик реплик в окне. Срок жизни ставим только при первой —
   * иначе окно продлевалось бы с каждым сообщением и не закрывалось.
   */
  async countInWindow(key: string, windowSeconds: number): Promise<number> {
    const redis = getRedis()
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, windowSeconds)
    return count
  },

  /** Отпечаток последней реплики — чтобы поймать повтор слово в слово. */
  async lastFingerprint(key: string): Promise<string | null> {
    return getRedis().get(key)
  },

  async markFingerprint(key: string, fingerprint: string, ttlSeconds: number): Promise<void> {
    await getRedis().setex(key, ttlSeconds, fingerprint)
  },
}
