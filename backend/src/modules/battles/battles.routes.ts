import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../shared/security/auth-middleware'
import { BattleService } from './battles.service'
import { z } from 'zod'

const StartPveSchema = z.object({ botCode: z.string().default('training_bandit') })
const ZoneEnum = z.enum(['HEAD', 'CHEST', 'LEGS', 'RIGHT_ARM', 'LEFT_ARM'])
const ActionSchema = z.object({
  action: z.enum(['attack', 'block', 'move', 'use_item', 'change_weapon', 'surrender']),
  itemInstanceId: z.string().uuid().optional(),
  weaponHand: z.enum(['LEFT_HAND', 'RIGHT_HAND']).optional(),
  moveTo: z.object({ x: z.number().int().min(0).max(8), y: z.number().int().min(0).max(8) }).optional(),
  targetParticipantId: z.string().uuid().optional(),
  // Зональная боёвка (опционально — старый фронт шлёт только action)
  stance: z.enum(['attack2', 'mixed', 'defense4']).optional(),
  attackZones: z.array(ZoneEnum).max(2).optional(),
  attackHands: z.array(z.enum(['LEFT_HAND', 'RIGHT_HAND'])).max(2).optional(),
  blockZones: z.array(ZoneEnum).max(4).optional(),
})
const AcceptDuelSchema = z.object({ battleId: z.string().uuid() })
const TeamCreateSchema = z.object({ perSide: z.number().int().min(1).max(10) })
const TeamJoinSchema = z.object({ battleId: z.string().uuid(), side: z.union([z.literal(1), z.literal(2)]) })

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

  // ── Командные бои ──────────────────────────────────────
  // POST /api/battles/team/create
  fastify.post('/team/create', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = TeamCreateSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const result = await BattleService.createTeamBattle(req.authUser.userId, parsed.data.perSide)
      return reply.code(201).send(result)
    })

  // GET /api/battles/team/open — бои, куда можно встать
  fastify.get('/team/open', { preHandler: authenticate },
    async (_req, reply) => reply.send(await BattleService.listTeamBattles()))

  // POST /api/battles/team/join
  fastify.post('/team/join', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = TeamJoinSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const result = await BattleService.joinTeamBattle(req.authUser.userId, parsed.data.battleId, parsed.data.side)
      return reply.send(result)
    })

  // POST /api/battles/team/start
  fastify.post('/team/start', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = AcceptDuelSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const result = await BattleService.startTeamBattle(req.authUser.userId, parsed.data.battleId)
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
          weaponHand: parsed.data.weaponHand,
          stance: parsed.data.stance,
          attackZones: parsed.data.attackZones,
          attackHands: parsed.data.attackHands,
          blockZones: parsed.data.blockZones,
          moveTo: parsed.data.moveTo,
          targetParticipantId: parsed.data.targetParticipantId,
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
