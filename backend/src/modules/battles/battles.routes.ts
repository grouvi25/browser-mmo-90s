import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate } from '../../shared/security/auth-middleware'
import { BattleService } from './battles.service'
import { z } from 'zod'

const StartPveSchema = z.object({ botCode: z.string().default('training_bandit') })
const ActionSchema = z.object({
  action: z.enum(['attack', 'block', 'use_item', 'change_weapon', 'surrender']),
  itemInstanceId: z.string().uuid().optional(),
})
const AcceptDuelSchema = z.object({ battleId: z.string().uuid() })

export async function battlesRoutes(fastify: FastifyInstance): Promise<void> {

  // POST /api/battles/pve/start
  fastify.post('/pve/start', { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = StartPveSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const result = await BattleService.startPve(req.authUser.userId, parsed.data.botCode)
      return reply.code(201).send(result)
    })

  // POST /api/battles/pvp/create
  fastify.post('/pvp/create', { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const result = await BattleService.createPvpDuel(req.authUser.userId)
      return reply.code(201).send(result)
    })

  // POST /api/battles/pvp/accept
  fastify.post('/pvp/accept', { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = AcceptDuelSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const result = await BattleService.acceptPvpDuel(req.authUser.userId, parsed.data.battleId)
      return reply.send(result)
    })

  // POST /api/battles/:battleId/action
  fastify.post('/:battleId/action', { preHandler: authenticate },
    async (req: FastifyRequest<{ Params: { battleId: string } }>, reply: FastifyReply) => {
      const parsed = ActionSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const result = await BattleService.submitAction(
        req.authUser.userId,
        req.params.battleId,
        parsed.data.action,
        parsed.data.itemInstanceId
      )
      return reply.send(result)
    })

  // GET /api/battles/:battleId
  fastify.get('/:battleId', { preHandler: authenticate },
    async (req: FastifyRequest<{ Params: { battleId: string } }>, reply: FastifyReply) => {
      const result = await BattleService.getBattle(req.params.battleId, req.authUser.userId)
      return reply.send(result)
    })
}
