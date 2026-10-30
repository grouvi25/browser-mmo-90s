import { createHash, randomUUID } from 'crypto'
import { AuthConfig } from '../../config/auth.config'
import { getRedis, SessionRedis } from '../db/redis'

export interface JwtPayload {
  sub: string    // userId
  jti: string    // unique session id
  iat: number
  exp: number
}

// We use @fastify/jwt for signing/verifying — this file provides helpers

export function generateJti(): string {
  return randomUUID()
}

export function hashJti(jti: string): string {
  return createHash('sha256').update(jti).digest('hex')
}

/** Store session in Redis so we can revoke it */
export async function storeSession(jti: string, userId: string): Promise<void> {
  await SessionRedis.set(jti, userId, AuthConfig.session.ttl)
}

/** Validate that session is still active in Redis */
export async function isSessionValid(jti: string): Promise<boolean> {
  const userId = await SessionRedis.get(jti)
  return userId !== null
}

/** Revoke a specific session */
export async function revokeSession(jti: string): Promise<void> {
  await SessionRedis.revoke(jti)
}

const ADMIN_SESSION_PREFIX = 'admin_session:'
const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60

// Сессии одной учётки — набором: «выйти везде» и снятие роли закрывают их разом.
const ADMIN_SESSIONS_OF = (adminId: string) => `admin_sessions_of:${adminId}`

export async function storeAdminSession(jti: string, adminId: string, ttlSeconds = ADMIN_SESSION_TTL_SECONDS): Promise<void> {
  await getRedis().multi()
    .setex(`${ADMIN_SESSION_PREFIX}${jti}`, ttlSeconds, adminId)
    .sadd(ADMIN_SESSIONS_OF(adminId), jti)
    .expire(ADMIN_SESSIONS_OF(adminId), ADMIN_SESSION_TTL_SECONDS)
    .exec()
}

/** Закрыть все сессии учётки админки; вернёт, сколько было. */
export async function revokeAllAdminSessions(adminId: string): Promise<number> {
  const redis = getRedis()
  const jtis = await redis.smembers(ADMIN_SESSIONS_OF(adminId))
  if (jtis.length) await redis.del(...jtis.map(jti => `${ADMIN_SESSION_PREFIX}${jti}`))
  await redis.del(ADMIN_SESSIONS_OF(adminId))
  return jtis.length
}

export async function isAdminSessionValid(jti: string, adminId?: string): Promise<boolean> {
  const storedAdminId = await getRedis().get(`${ADMIN_SESSION_PREFIX}${jti}`)
  return storedAdminId !== null && (adminId === undefined || storedAdminId === adminId)
}

export async function revokeAdminSession(jti: string): Promise<void> {
  await getRedis().del(`${ADMIN_SESSION_PREFIX}${jti}`)
}
