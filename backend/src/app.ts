import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCors from '@fastify/cors'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import { createAdapter } from '@socket.io/redis-adapter'
import { Server as SocketIO } from 'socket.io'
import { getRedis, getRedisSub } from '../shared/db/redis'
import { AppConfig } from '../config/app.config'
import { AuthConfig } from '../config/auth.config'
import { AppError } from '../shared/errors/app-error'
import { logger } from '../shared/logger/logger'

// Routes
import { authRoutes } from '../modules/auth/auth.routes'
import { charactersRoutes } from '../modules/characters/characters.routes'
import { inventoryRoutes } from '../modules/inventory/inventory.routes'
import { governmentShopRoutes } from '../modules/government-shop/government-shop.routes'
import { battlesRoutes } from '../modules/battles/battles.routes'
import { repairRoutes } from '../modules/repair/repair.routes'

export async function buildApp() {
  const fastify = Fastify({
    logger: false, // using pino directly
    trustProxy: true,
  })

  // -------------------------------------------------------
  // Plugins
  // -------------------------------------------------------
  await fastify.register(fastifyHelmet, { contentSecurityPolicy: false })

  await fastify.register(fastifyCors, {
    origin: AppConfig.server.corsOrigin,
    credentials: true,
  })

  await fastify.register(fastifyRateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    redis: getRedis(),  // Rate limiting via Redis — works across all instances!
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({
      code: 'GEN_004',
      message: 'Too many requests, slow down',
    }),
  })

  await fastify.register(fastifyJwt, {
    secret: AuthConfig.jwt.secret,
  })

  // -------------------------------------------------------
  // Error handler
  // -------------------------------------------------------
  fastify.setErrorHandler((err, _req, reply) => {
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

  // -------------------------------------------------------
  // Routes
  // -------------------------------------------------------
  fastify.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))

  await fastify.register(authRoutes, { prefix: '/api/auth' })
  await fastify.register(charactersRoutes, { prefix: '/api/characters' })
  await fastify.register(inventoryRoutes, { prefix: '/api/inventory' })
  await fastify.register(governmentShopRoutes, { prefix: '/api/shops/government' })
  await fastify.register(battlesRoutes, { prefix: '/api/battles' })
  await fastify.register(repairRoutes, { prefix: '/api/repair' })

  return fastify
}

// -------------------------------------------------------
// Socket.io setup (call after server is listening)
// -------------------------------------------------------
export async function setupSocketIO(httpServer: ReturnType<typeof Fastify>['server']) {
  const io = new SocketIO(httpServer, {
    cors: { origin: AppConfig.server.corsOrigin, credentials: true },
    transports: ['websocket', 'polling'],
  })

  // CRITICAL: Redis adapter for multi-instance support
  const pubClient = getRedis()
  const subClient = getRedisSub()
  io.adapter(createAdapter(pubClient, subClient))
  logger.info('[Socket.io] Redis adapter attached')

  io.on('connection', (socket) => {
    logger.debug({ socketId: socket.id }, '[Socket.io] Client connected')

    socket.on('join:battle', (battleId: string) => {
      socket.join(`battle:${battleId}`)
    })

    socket.on('disconnect', () => {
      logger.debug({ socketId: socket.id }, '[Socket.io] Client disconnected')
    })
  })

  return io
}
