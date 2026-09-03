import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { simulateBalanceSandbox } from './balance-sandbox.service'

const Input = z.object({
  days: z.number().int().min(8).max(365),
  players: z.number().int().min(3).max(10_000),
  salary: z.number().int().min(1).max(5_000),
  battleReward: z.number().int().min(0).max(5_000),
  repairCost: z.number().int().min(0).max(10_000),
  marketPrice: z.number().int().min(1).max(1_000_000),
  shiftMinutes: z.number().int().min(30).max(90),
  winRate: z.number().int().min(10).max(95),
})

export async function balanceSandboxRoutes(fastify: FastifyInstance) {
  fastify.post('/simulate', { preHandler: authenticate }, async (request, reply) => {
    const parsed = Input.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten() })
    }
    return reply.send(simulateBalanceSandbox(parsed.data))
  })
}
