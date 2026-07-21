import Fastify from 'fastify'
import type { FastifyError } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCors from '@fastify/cors'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import { createAdapter } from '@socket.io/redis-adapter'
import { Server as SocketIO } from 'socket.io'
import { getRedis, getRedisSub } from './shared/db/redis'
import { AppConfig } from './config/app.config'
import { AuthConfig } from './config/auth.config'
import { AppError } from './shared/errors/app-error'
import { logger } from './shared/logger/logger'

// Routes
import { authRoutes } from './modules/auth/auth.routes'
import { charactersRoutes } from './modules/characters/characters.routes'
import { inventoryRoutes } from './modules/inventory/inventory.routes'
import { governmentShopRoutes } from './modules/government-shop/government-shop.routes'
import { battlesRoutes } from './modules/battles/battles.routes'
import { repairRoutes } from './modules/repair/repair.routes'
import { adminBasicRoutes } from './modules/admin-basic/admin-basic.routes'

export async function buildApp() {
  const fastify = Fastify({
    logger: false,
    trustProxy: true,
  })

  await fastify.register(fastifyHelmet, { contentSecurityPolicy: false })

  await fastify.register(fastifyCors, {
    origin: AppConfig.server.corsOrigin,
    credentials: true,
  })

  // ── Rate limiting — tiered по типу endpoint ─────────────────
  // Global: 3600/min (60/sec) — достаточно для активного игрока
  // Auth: строже — 20 попыток в минуту (защита от брутфорса)
  // Battle actions: мягче — быстрые игровые запросы
  await fastify.register(fastifyRateLimit, {
    global: true,
    max: 3600,             // 60 req/sec per real IP (было 600)
    timeWindow: '1 minute',
    redis: getRedis(),
    keyGenerator: (req) => {
      return (req.headers['cf-connecting-ip'] as string)
          || (req.headers['x-real-ip'] as string)
          || req.ip
    },
    errorResponseBuilder: () => ({
      code: 'GEN_004',
      message: 'Слишком много запросов, подождите немного',
    }),
  })

  await fastify.register(fastifyJwt, {
    secret: AuthConfig.jwt.secret,
  })

  // ── Error handler ────────────────────────────────────────────
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

  // ── Routes ───────────────────────────────────────────────────
  // /health — no rate limit, no auth, instant response
  fastify.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))

  // Auth — strict rate limit: 30 attempts/min to prevent brute force
  await fastify.register(authRoutes, { prefix: '/api/auth' })

  await fastify.register(charactersRoutes,     { prefix: '/api/characters' })
  await fastify.register(inventoryRoutes,      { prefix: '/api/inventory' })
  await fastify.register(governmentShopRoutes, { prefix: '/api/shops/government' })
  await fastify.register(battlesRoutes,        { prefix: '/api/battles' })
  await fastify.register(repairRoutes,         { prefix: '/api/repair' })
  await fastify.register(adminBasicRoutes,     { prefix: '/api/admin' })

  return fastify
}

// ── Socket.io setup ──────────────────────────────────────────
export async function setupSocketIO(httpServer: ReturnType<typeof Fastify>['server']) {
  const io = new SocketIO(httpServer, {
    cors: { origin: AppConfig.server.corsOrigin, credentials: true },
    transports: ['websocket', 'polling'],
  })

  const pubClient = getRedis()
  const subClient = getRedisSub()
  io.adapter(createAdapter(pubClient, subClient))
  logger.info('[Socket.io] Redis adapter attached')

  io.on('connection', (socket) => {
    socket.on('join:battle', (battleId: string) => {
      socket.join(`battle:${battleId}`)
    })
  })

  return io
}
