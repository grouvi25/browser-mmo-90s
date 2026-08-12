import type { FastifyRequest, FastifyReply } from 'fastify'
import type { AdminRole } from '@prisma/client'
import { AppError } from '../errors/app-error'
import { ErrorCode } from '../errors/error-codes'
import { prisma } from '../db/prisma'
import { isAdminSessionValid, isSessionValid } from './jwt'

export interface AuthUser {
  userId: string
  jti: string
}

export interface AdminAuthUser {
  adminId: string
  jti: string
  role: AdminRole
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser
    adminUser: AdminAuthUser
  }
}

/**
 * Fastify preHandler hook — validates JWT and checks Redis session.
 * Usage: fastify.addHook('preHandler', authenticate) or per-route.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // @fastify/jwt attaches jwtVerify to request
    const payload = await request.jwtVerify<{ sub: string; jti: string }>()

    // Check session is still alive in Redis (not revoked)
    const valid = await isSessionValid(payload.jti)
    if (!valid) {
      throw new AppError(ErrorCode.SESSION_REVOKED, 'Session has been revoked', 401)
    }

    request.authUser = {
      userId: payload.sub,
      jti:    payload.jti,
    }
  } catch (err: unknown) {
    if (err instanceof AppError) {
      reply.code(err.statusCode).send({ code: err.code, message: err.message })
      return
    }
    reply.code(401).send({ code: ErrorCode.TOKEN_INVALID, message: 'Invalid or expired token' })
  }
}

/**
 * Optional admin authentication middleware.
 */
export async function authenticateAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const payload = await request.jwtVerify<{ role?: string; adminId?: string; jti: string }>()
    if (payload.role !== 'admin' || !payload.adminId) {
      throw AppError.forbidden('Admin access required')
    }
    if (!(await isAdminSessionValid(payload.jti, payload.adminId))) {
      throw new AppError(ErrorCode.SESSION_REVOKED, 'Session has been revoked', 401)
    }
    const admin = await prisma.adminUser.findUnique({
      where: { id: payload.adminId },
      select: { role: true, isActive: true },
    })
    if (!admin?.isActive) {
      throw new AppError(ErrorCode.SESSION_REVOKED, 'Admin account is inactive', 401)
    }
    request.adminUser = { adminId: payload.adminId, jti: payload.jti, role: admin.role }
  } catch (err: unknown) {
    if (err instanceof AppError) {
      reply.code(err.statusCode).send({ code: err.code, message: err.message })
      return
    }
    reply.code(401).send({ code: ErrorCode.UNAUTHORIZED, message: 'Unauthorized' })
  }
}

export function requireAdminRole(...roles: AdminRole[]) {
  return async function authorizeAdminRole(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await authenticateAdmin(request, reply)
    if (reply.sent) return
    if (!roles.includes(request.adminUser.role)) {
      reply.code(403).send({ code: ErrorCode.FORBIDDEN, message: 'Insufficient admin role' })
    }
  }
}
