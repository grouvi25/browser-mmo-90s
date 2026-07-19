import type { FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '../errors/app-error'
import { ErrorCode } from '../errors/error-codes'
import { isSessionValid } from './jwt'

export interface AuthUser {
  userId: string
  jti: string
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser
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
    const payload = await request.jwtVerify<{ sub: string; role: string; jti: string }>()
    if (payload.role !== 'admin') {
      throw AppError.forbidden('Admin access required')
    }
    request.authUser = { userId: payload.sub, jti: payload.jti }
  } catch (err: unknown) {
    if (err instanceof AppError) {
      reply.code(err.statusCode).send({ code: err.code, message: err.message })
      return
    }
    reply.code(401).send({ code: ErrorCode.UNAUTHORIZED, message: 'Unauthorized' })
  }
}
