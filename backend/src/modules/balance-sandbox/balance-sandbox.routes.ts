import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../shared/security/auth-middleware'
import { BalanceSandboxSchema, simulateBalanceSandbox } from './balance-sandbox.service'

export async function balanceSandboxRoutes(fastify: FastifyInstance) {
  fastify.post('/simulate', { preHandler: authenticate }, async (request, reply) => {
    // Границы входа заданы рядом с расчётом: у песочницы две двери —
    // игровая и админская, — и проверять они обязаны одинаково.
    const parsed = BalanceSandboxSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten() })
    }
    return reply.send(simulateBalanceSandbox(parsed.data))
  })
}
