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

export async function storeAdminSession(jti: string, adminId: string): Promise<void> {
  await getRedis().setex(`${ADMIN_SESSION_PREFIX}${jti}`, ADMIN_SESSION_TTL_SECONDS, adminId)
}

export async function isAdminSessionValid(jti: string, adminId?: string): Promise<boolean> {
  const storedAdminId = await getRedis().get(`${ADMIN_SESSION_PREFIX}${jti}`)
  return storedAdminId !== null && (adminId === undefined || storedAdminId === adminId)
}

export async function revokeAdminSession(jti: string): Promise<void> {
  await getRedis().del(`${ADMIN_SESSION_PREFIX}${jti}`)
}
