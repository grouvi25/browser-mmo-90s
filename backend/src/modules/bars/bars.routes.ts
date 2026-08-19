import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { CharactersRepository } from '../characters/characters.repository'
import { BarsService } from './bars.service'

const Id = z.string().uuid()

export async function barsRoutes(fastify: FastifyInstance) {
  const character = async (userId: string) => {
    const item = await CharactersRepository.findByUserId(userId)
    if (!item) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    return item
  }

  fastify.get('/', { preHandler: authenticate }, async (_req, reply) => reply.send(await BarsService.list()))

  fastify.get('/status', { preHandler: authenticate }, async (req, reply) => {
    const actor = await character(req.authUser.userId)
    return reply.send(await BarsService.status(actor.id))
  })

  fastify.post<{ Params: { offerId: string } }>('/offers/:offerId/buy', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.offerId).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const key = req.headers['idempotency-key']
    if (typeof key !== 'string') return reply.code(400).send({ code: ErrorCode.ECON_IDEMPOTENCY_REQUIRED, message: 'Idempotency-Key is required' })
    const actor = await character(req.authUser.userId)
    return reply.send(await BarsService.buy(actor.id, req.params.offerId, key))
  })

  fastify.patch<{ Params: { offerId: string }; Body: { price: number } }>('/offers/:offerId/price', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ price: z.number().int().positive() }).safeParse(req.body)
    if (!Id.safeParse(req.params.offerId).success || !parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const actor = await character(req.authUser.userId)
    return reply.send(await BarsService.setPrice(actor.id, req.params.offerId, parsed.data.price))
  })
}
