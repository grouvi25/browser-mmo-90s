import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../shared/security/auth-middleware'
import { BattleService } from './battles.service'
import { z } from 'zod'

const StartPveSchema = z.object({ botCode: z.string().default('training_bandit') })
const ZoneEnum = z.enum(['HEAD', 'CHEST', 'LEGS', 'RIGHT_ARM', 'LEFT_ARM'])
const ActionSchema = z.object({
  action: z.enum(['attack', 'block', 'use_item', 'change_weapon', 'surrender']),
  itemInstanceId: z.string().uuid().optional(),
  // Зональная боёвка (опционально — старый фронт шлёт только action)
  stance: z.enum(['attack2', 'mixed', 'defense4']).optional(),
  attackZones: z.array(ZoneEnum).max(2).optional(),
  blockZones: z.array(ZoneEnum).max(4).optional(),
})
const AcceptDuelSchema = z.object({ battleId: z.string().uuid() })
const CreateDuelSchema = z.object({
  levelMin: z.number().int().min(1).max(99).optional(),
  levelMax: z.number().int().min(1).max(99).optional(),
})
const HistorySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export async function battlesRoutes(fastify: FastifyInstance): Promise<void> {

  // POST /api/battles/pve/start
  fastify.post('/pve/start', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = StartPveSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const result = await BattleService.startPve(req.authUser.userId, parsed.data.botCode)
      return reply.code(201).send(result)
    })

  // POST /api/battles/pvp/create
  fastify.post('/pvp/create', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = CreateDuelSchema.safeParse(req.body)
      const result = await BattleService.createPvpDuel(
        req.authUser.userId,
        parsed.success ? parsed.data.levelMin : undefined,
        parsed.success ? parsed.data.levelMax : undefined,
      )
      return reply.code(201).send(result)
    })

  // GET /api/battles/pvp/open — список открытых дуэлей
  fastify.get('/pvp/open', { preHandler: authenticate },
    async (req, reply) => {
      const result = await BattleService.listOpenDuels(req.authUser.userId)
      return reply.send(result)
    })

  // POST /api/battles/pvp/accept
  fastify.post('/pvp/accept', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = AcceptDuelSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const result = await BattleService.acceptPvpDuel(req.authUser.userId, parsed.data.battleId)
      return reply.send(result)
    })

  // GET /api/battles/me/history — история боёв персонажа
  fastify.get('/me/history', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = HistorySchema.safeParse(req.query)
      const { page, limit } = parsed.success ? parsed.data : { page: 1, limit: 20 }
      const result = await BattleService.getBattleHistory(req.authUser.userId, page, limit)
      return reply.send(result)
    })

  // POST /api/battles/:battleId/action
  fastify.post<{ Params: { battleId: string } }>('/:battleId/action', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = ActionSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const result = await BattleService.submitAction(
        req.authUser.userId,
        req.params.battleId,
        {
          action: parsed.data.action,
          itemInstanceId: parsed.data.itemInstanceId,
          stance: parsed.data.stance,
          attackZones: parsed.data.attackZones,
          blockZones: parsed.data.blockZones,
        }
      )
      return reply.send(result)
    })

  // GET /api/battles/:battleId
  fastify.get<{ Params: { battleId: string } }>('/:battleId', { preHandler: authenticate },
    async (req, reply) => {
      const result = await BattleService.getBattle(req.params.battleId, req.authUser.userId)
      return reply.send(result)
    })
}
