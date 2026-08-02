import Fastify from 'fastify'
import type { FastifyError, FastifyInstance } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCors from '@fastify/cors'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import { createAdapter } from '@socket.io/redis-adapter'
import { Server as SocketIO, type Socket } from 'socket.io'
import { getRedis, getRedisSub } from './shared/db/redis'
import { prisma } from './shared/db/prisma'
import { isSessionValid } from './shared/security/jwt'
import { AppConfig } from './config/app.config'
import { AuthConfig } from './config/auth.config'
import { AppError } from './shared/errors/app-error'
import { logger } from './shared/logger/logger'

import { authRoutes } from './modules/auth/auth.routes'
import { charactersRoutes } from './modules/characters/characters.routes'
import { inventoryRoutes } from './modules/inventory/inventory.routes'
import { governmentShopRoutes } from './modules/government-shop/government-shop.routes'
import { battlesRoutes } from './modules/battles/battles.routes'
import { repairRoutes } from './modules/repair/repair.routes'
import { adminBasicRoutes } from './modules/admin-basic/admin-basic.routes'
import { adminAuthRoutes } from './modules/admin-auth/admin-auth.routes'
import { resourcesRoutes } from './modules/resources/resources.routes'
import { workRoutes } from './modules/work/work.routes'

export async function buildApp() {
  const fastify = Fastify({
    logger: false,
    // Production publishes the API on loopback only; nginx is the sole proxy.
    trustProxy: true,
  })

  await fastify.register(fastifyHelmet)

  await fastify.register(fastifyCors, {
    origin: AppConfig.server.corsOrigin,
    credentials: true,
  })

  await fastify.register(fastifyRateLimit, {
    global: true,
    max: 3600,
    timeWindow: '1 minute',
    redis: getRedis(),
    // req.ip is calculated by Fastify using the trusted proxy chain. Do not
    // consume client-controlled forwarding headers directly here.
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({
      code: 'GEN_004',
      message: 'Слишком много запросов, подождите немного',
    }),
  })

  await fastify.register(fastifyJwt, {
    secret: AuthConfig.jwt.secret,
  })

  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || (body as string).trim() === '') return done(null, {})
    try {
      done(null, JSON.parse(body as string))
    } catch (err: unknown) {
      const e = err as Error & { statusCode?: number }
      e.statusCode = 400
      done(e, undefined)
    }
  })

  fastify.setErrorHandler((err: FastifyError & { details?: unknown }, _req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        code: err.code,
        message: err.message,
        details: err.details,
      })
    }
    if (err.statusCode === 429) {
      return reply.code(429).send({ code: 'GEN_004', message: 'Rate limited' })
    }
    logger.error({ err }, 'Unhandled error')
    return reply.code(500).send({ code: 'GEN_003', message: 'Internal server error' })
  })

  fastify.get('/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    ts: new Date().toISOString(),
  }))

  await fastify.register(authRoutes,           { prefix: '/api/auth' })
  await fastify.register(charactersRoutes,     { prefix: '/api/characters' })
  await fastify.register(inventoryRoutes,      { prefix: '/api/inventory' })
  await fastify.register(governmentShopRoutes, { prefix: '/api/shops/government' })
  await fastify.register(battlesRoutes,        { prefix: '/api/battles' })
  await fastify.register(repairRoutes,         { prefix: '/api/repair' })
  await fastify.register(resourcesRoutes,      { prefix: '/api/resources' })
  await fastify.register(workRoutes,           { prefix: '/api/work' })
  await fastify.register(adminAuthRoutes,      { prefix: '/api/admin/auth' })
  await fastify.register(adminBasicRoutes,     { prefix: '/api/admin' })

  return fastify
}

function socketBearerToken(socket: Socket): string | null {
  const authToken = socket.handshake.auth?.token
  if (typeof authToken === 'string' && authToken.length > 0) return authToken

  const authorization = socket.handshake.headers.authorization
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length)
  }
  return null
}

export async function setupSocketIO(app: FastifyInstance) {
  const io = new SocketIO(app.server, {
    cors: { origin: AppConfig.server.corsOrigin, credentials: true },
    transports: ['websocket', 'polling'],
  })

  const pubClient = getRedis()
  const subClient = getRedisSub()
  io.adapter(createAdapter(pubClient, subClient))
  logger.info('[Socket.io] Redis adapter attached')

  io.use(async (socket, next) => {
    try {
      const token = socketBearerToken(socket)
      if (!token) return next(new Error('Unauthorized'))

      const payload = app.jwt.verify<{ sub: string; jti: string }>(token)
      if (!payload.sub || !payload.jti || !(await isSessionValid(payload.jti))) {
        return next(new Error('Unauthorized'))
      }

      socket.data.userId = payload.sub
      socket.data.jti = payload.jti
      next()
    } catch {
      next(new Error('Unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    socket.on('join:battle', async (battleId: unknown, acknowledge?: (result: { ok: boolean; error?: string }) => void) => {
      try {
        if (typeof battleId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(battleId)) {
          acknowledge?.({ ok: false, error: 'Invalid battle id' })
          return
        }

        const participant = await prisma.battleParticipant.findFirst({
          where: {
            battleId,
            character: { userId: socket.data.userId as string },
          },
          select: { id: true },
        })
        if (!participant) {
          acknowledge?.({ ok: false, error: 'Not a battle participant' })
          return
        }

        await socket.join(`battle:${battleId}`)
        acknowledge?.({ ok: true })
      } catch (err) {
        logger.warn({ err, battleId, userId: socket.data.userId }, 'Socket battle join rejected')
        acknowledge?.({ ok: false, error: 'Unable to join battle' })
      }
    })
  })

  return io
}
