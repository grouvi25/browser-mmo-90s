import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { CharactersRepository } from '../characters/characters.repository'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { ResourcesService } from './resources.service'

const SellSchema = z.object({ resourceCode: z.string().min(1).max(64), amount: z.number().int().min(1).max(10000) })

export async function resourcesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', { preHandler: authenticate }, async (req, reply) => {
    const character = await CharactersRepository.findByUserId(req.authUser.userId)
    if (!character) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    return reply.send(await ResourcesService.list(character.id))
  })

  fastify.post('/sell', { preHandler: authenticate }, async (req, reply) => {
    const parsed = SellSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten().fieldErrors })
    const key = req.headers['idempotency-key']
    if (typeof key !== 'string') return reply.code(400).send({ code: ErrorCode.ECON_IDEMPOTENCY_REQUIRED, message: 'Idempotency-Key is required' })
    const character = await CharactersRepository.findByUserId(req.authUser.userId)
    if (!character) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    return reply.send(await ResourcesService.sell(character.id, parsed.data.resourceCode, parsed.data.amount, key))
  })
}
