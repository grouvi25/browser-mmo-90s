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
import { checkReadiness } from './shared/health/readiness'
import { setRealtimeServer } from './shared/realtime/io'
import { ChatService } from './modules/chat/chat.service'
import { chatRoom, DISTRICTS } from './modules/chat/chat.formulas'

import { authRoutes } from './modules/auth/auth.routes'
import { charactersRoutes } from './modules/characters/characters.routes'
import { inventoryRoutes } from './modules/inventory/inventory.routes'
import { governmentShopRoutes } from './modules/government-shop/government-shop.routes'
import { battlesRoutes } from './modules/battles/battles.routes'
import { repairRoutes } from './modules/repair/repair.routes'
import { adminBasicRoutes } from './modules/admin-basic/admin-basic.routes'
import { adminStrategyRoutes } from './modules/admin-strategy/admin-strategy.routes'
import { adminActionsRoutes } from './modules/admin-actions/admin-actions.routes'
import { adminAuthRoutes } from './modules/admin-auth/admin-auth.routes'
import { adminBalanceRoutes } from './modules/admin-balance/admin-balance.routes'
import { resourcesRoutes } from './modules/resources/resources.routes'
import { workRoutes } from './modules/work/work.routes'
import { privateShopsRoutes } from './modules/private-shops/private-shops.routes'
import { marketRoutes } from './modules/market/market.routes'
import { upgradesRoutes } from './modules/upgrades/upgrades.routes'
import { productionRoutes } from './modules/production/production.routes'
import { farmRoutes } from './modules/farm/farm.routes'
import { barsRoutes } from './modules/bars/bars.routes'
import { chatRoutes } from './modules/chat/chat.routes'
import { announcementsRoutes } from './modules/announcements/announcements.routes'
import { clansRoutes } from './modules/clans/clans.routes'
import { territoriesRoutes, clanTerritoriesRoutes, objectWarRoutes } from './modules/territories/territories.routes'
import { premiumRoutes, helpersRoutes } from './modules/premium/premium.routes'
import { stage3AcceptanceRoutes } from './modules/stage3-acceptance/stage3-acceptance.routes'
import { balanceSandboxRoutes } from './modules/balance-sandbox/balance-sandbox.routes'

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
    // По умолчанию @fastify/cors отдаёт браузеру только GET, HEAD и POST,
    // и предполётный запрос на PATCH или DELETE отклоняется ещё до ручки —
    // на клиенте это выглядит как «Failed to fetch» без единой строчки в
    // логах сервера. Игровые ручки этими методами не пользовались, а
    // админские правки (коэффициент, предмет) — как раз PATCH и DELETE.
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
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
    const databaseCode = typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : undefined
    logger.error({ err, databaseCode }, 'Unhandled error')
    return reply.code(500).send({
      code: 'GEN_003',
      message: 'Internal server error',
      ...(databaseCode ? { details: { databaseCode } } : {}),
    })
  })

  fastify.get('/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    ts: new Date().toISOString(),
  }))

  fastify.get('/ready', { config: { rateLimit: false } }, async (_req, reply) => {
    const readiness = await checkReadiness(
      () => prisma.$queryRaw`SELECT 1`,
      () => getRedis().ping(),
    )
    return reply.code(readiness.status === 'ready' ? 200 : 503).send(readiness)
  })

  await fastify.register(authRoutes,           { prefix: '/api/auth' })
  await fastify.register(charactersRoutes,     { prefix: '/api/characters' })
  await fastify.register(inventoryRoutes,      { prefix: '/api/inventory' })
  await fastify.register(governmentShopRoutes, { prefix: '/api/shops/government' })
  await fastify.register(battlesRoutes,        { prefix: '/api/battles' })
  await fastify.register(repairRoutes,         { prefix: '/api/repair' })
  await fastify.register(resourcesRoutes,      { prefix: '/api/resources' })
  await fastify.register(workRoutes,           { prefix: '/api/work' })
  await fastify.register(productionRoutes,     { prefix: '/api/production' })
  await fastify.register(farmRoutes,           { prefix: '/api/farm' })
  await fastify.register(barsRoutes,           { prefix: '/api/bars' })
  await fastify.register(chatRoutes,           { prefix: '/api/chat' })
  await fastify.register(announcementsRoutes,  { prefix: '/api/announcements' })
  await fastify.register(clansRoutes,          { prefix: '/api/clans' })
  // Территории клана — под тем же префиксом, что и сам клан:
  // адрес /api/clans/:id/territories задан в STAGE4_API 1.3.
  await fastify.register(clanTerritoriesRoutes, { prefix: '/api/clans' })
  await fastify.register(territoriesRoutes,   { prefix: '/api/territories' })
  // Атаки на объекты и перевод в клан — рядом с остальными
  // операциями над объектами Этапа 3.
  await fastify.register(objectWarRoutes,     { prefix: '/api/objects' })
  await fastify.register(premiumRoutes,       { prefix: '/api/premium' })
  await fastify.register(helpersRoutes,       { prefix: '/api/helpers' })
  await fastify.register(stage3AcceptanceRoutes,{ prefix: '/api/stage3/acceptance' })
  await fastify.register(balanceSandboxRoutes, { prefix: '/api/balance-sandbox' })
  await fastify.register(privateShopsRoutes,   { prefix: '/api/private-shops' })
  await fastify.register(marketRoutes,         { prefix: '/api/market' })
  await fastify.register(upgradesRoutes,       { prefix: '/api/upgrades' })
  await fastify.register(adminAuthRoutes,      { prefix: '/api/admin/auth' })
  await fastify.register(adminBasicRoutes,     { prefix: '/api/admin' })
  await fastify.register(adminStrategyRoutes, { prefix: '/api/admin' })
  await fastify.register(adminActionsRoutes,  { prefix: '/api/admin' })
  await fastify.register(adminBalanceRoutes,  { prefix: '/api/admin' })

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

    // ── Эфир ──────────────────────────────────────────────
    // Общий канал и канал своего клана подключаются сразу: их состав
    // от перемещений игрока не зависит. Район меняется при ходьбе по
    // городу, поэтому его комнату переключает клиент отдельно.
    void (async () => {
      try {
        const who = await ChatService.speaker(socket.data.userId as string)
        socket.data.characterId = who.characterId
        await ChatService.touch(who.characterId)
        await socket.join(chatRoom('GLOBAL', ''))
        if (who.clanId) await socket.join(chatRoom('CLAN', who.clanId))
      } catch (err) {
        // Персонажа может не быть — аккаунт создан, герой ещё нет.
        // Это не повод рвать соединение: бой и служебные события живут
        // своей жизнью, просто эфир такому гостю не подключаем.
        logger.debug({ err, userId: socket.data.userId }, 'Socket chat rooms skipped')
      }
    })()

    socket.on('chat:district', async (district: unknown, acknowledge?: (r: { ok: boolean }) => void) => {
      if (typeof district !== 'string' || !(DISTRICTS as readonly string[]).includes(district)) {
        acknowledge?.({ ok: false })
        return
      }
      // Район ровно один: перед входом в новый выходим из прежних,
      // иначе игрок копил бы комнаты и слышал весь город сразу.
      for (const room of socket.rooms) {
        if (room.startsWith('chat:DISTRICT:')) await socket.leave(room)
      }
      await socket.join(chatRoom('DISTRICT', district))
      const characterId = socket.data.characterId as string | undefined
      if (characterId) await ChatService.touch(characterId)
      acknowledge?.({ ok: true })
    })

    socket.on('disconnect', () => {
      const characterId = socket.data.characterId as string | undefined
      if (characterId) void ChatService.leave(characterId)
    })
  })

  setRealtimeServer(io)
  return io
}
