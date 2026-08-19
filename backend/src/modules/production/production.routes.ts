import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { CharactersRepository } from '../characters/characters.repository'
import { ProductionService } from './production.service'

const Id = z.string().uuid()

export async function productionRoutes(fastify: FastifyInstance) {
  const character = async (userId: string) => {
    const item = await CharactersRepository.findByUserId(userId)
    if (!item) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    return item
  }

  fastify.get('/objects', { preHandler: authenticate }, async (_req, reply) => {
    return reply.send(await ProductionService.list())
  })

  fastify.get<{ Params: { id: string } }>('/objects/:id', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    return reply.send(await ProductionService.get(req.params.id))
  })

  fastify.get<{ Querystring: { objectCode?: string } }>('/recipes', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ objectCode: z.string().min(1) }).safeParse(req.query)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const actor = await character(req.authUser.userId)
    return reply.send({ items: await ProductionService.recipes(parsed.data.objectCode, actor.id) })
  })

  fastify.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/objects/:id/cycles', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const limit = Number(req.query.limit ?? 20)
    return reply.send({ items: await ProductionService.cycles(req.params.id, Number.isFinite(limit) ? limit : 20) })
  })

  fastify.post<{ Params: { id: string } }>('/objects/:id/cycles/start', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const result = await ProductionService.startCycle(req.params.id)
    return reply.code('cycle' in result ? 201 : 409).send(result)
  })
}
