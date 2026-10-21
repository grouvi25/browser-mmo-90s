import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { CharactersRepository } from '../characters/characters.repository'
import { HousingService } from './housing.service'
import { LOT_COUNT } from './housing.config'

/** Жилой сектор — /api/housing. */
export async function housingRoutes(fastify: FastifyInstance) {
  const me = async (userId: string) => {
    const item = await CharactersRepository.findByUserId(userId)
    if (!item) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    return item
  }
  const bad = { code: 'GEN_001', message: 'Validation error' }

  fastify.get('/', { preHandler: authenticate }, async req => HousingService.view((await me(req.authUser.userId)).id))

  fastify.post<{ Body: { lot: number } }>('/buy', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ lot: z.number().int().min(1).max(LOT_COUNT) }).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(bad)
    return reply.send(await HousingService.buy((await me(req.authUser.userId)).id, parsed.data.lot))
  })

  fastify.post<{ Body: { code: string } }>('/tunnels', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ code: z.enum(['pvp', 'industrial', 'farm']) }).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(bad)
    return reply.send(await HousingService.buyTunnel((await me(req.authUser.userId)).id, parsed.data.code))
  })

  fastify.post('/repair', { preHandler: authenticate }, async req => HousingService.repair((await me(req.authUser.userId)).id))

  fastify.post<{ Params: { id: string } }>('/:id/raid', { preHandler: authenticate }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(422).send(bad)
    const char = await me(req.authUser.userId)
    return reply.send(await HousingService.raid(req.authUser.userId, char.id, req.params.id))
  })
}
