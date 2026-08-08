import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { ProductionService } from './production.service'
export async function productionRoutes(fastify: FastifyInstance) {
  fastify.get('/objects', { preHandler: authenticate }, async (_req, reply) => reply.send(await ProductionService.list()))
  fastify.get<{ Params: { id: string } }>('/objects/:id', { preHandler: authenticate }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    return reply.send(await ProductionService.get(req.params.id))
  })
}
