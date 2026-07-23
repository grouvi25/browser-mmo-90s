import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { GovernmentShopService } from './government-shop.service'
import { authenticate } from '../../shared/security/auth-middleware'
import { CharactersRepository } from '../characters/characters.repository'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { getRedis } from '../../shared/db/redis'
import { z } from 'zod'

const BuySchema = z.object({ templateId: z.string().uuid() })
const SellSchema = z.object({ itemInstanceId: z.string().uuid() })

const SHOP_CACHE_KEY = 'cache:shop:government:items'
const SHOP_CACHE_TTL = 300 // 5 minutes — shop items rarely change

export async function governmentShopRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/shops/government/items — cached 5 min in Redis
  fastify.get('/items', { preHandler: authenticate },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const redis = getRedis()
      const cached = await redis.get(SHOP_CACHE_KEY)
      if (cached) {
        return reply
          .header('X-Cache', 'HIT')
          .header('Cache-Control', 'public, max-age=60')
          .send(JSON.parse(cached))
      }
      const items = await GovernmentShopService.listItems()
      await redis.setex(SHOP_CACHE_KEY, SHOP_CACHE_TTL, JSON.stringify(items))
      return reply
        .header('X-Cache', 'MISS')
        .header('Cache-Control', 'public, max-age=60')
        .send(items)
    })

  // POST /api/shops/government/buy
  fastify.post('/buy', { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = BuySchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })

      const char = await CharactersRepository.findByUserId(req.authUser.userId)
      if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)

      const result = await GovernmentShopService.buy(char.id, parsed.data.templateId)
      return reply.code(201).send(result)
    })

  // POST /api/shops/government/sell
  fastify.post('/sell', { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = SellSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })

      const char = await CharactersRepository.findByUserId(req.authUser.userId)
      if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)

      const result = await GovernmentShopService.sell(char.id, parsed.data.itemInstanceId)
      return reply.send(result)
    })

  // POST /api/shops/government/discard — выбросить предмет (без денег)
  fastify.post('/discard', { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = SellSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })

      const char = await CharactersRepository.findByUserId(req.authUser.userId)
      if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)

      const result = await GovernmentShopService.discard(char.id, parsed.data.itemInstanceId)
      return reply.send(result)
    })
}
