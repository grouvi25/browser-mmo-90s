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

  // Склад жилья: дополнительные ящики, из центра их не видно (правка 22.10).
  const move = z.object({ code: z.string().min(1).max(64), amount: z.number().int().min(1).max(1000) })
  fastify.get('/storage', { preHandler: authenticate }, async req => HousingService.storage((await me(req.authUser.userId)).id))
  fastify.post<{ Body: { code: string; amount: number } }>('/storage/put', { preHandler: authenticate }, async (req, reply) => {
    const parsed = move.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(bad)
    return reply.send(await HousingService.storagePut((await me(req.authUser.userId)).id, parsed.data.code, parsed.data.amount))
  })
  fastify.post<{ Body: { code: string; amount: number } }>('/storage/take', { preHandler: authenticate }, async (req, reply) => {
    const parsed = move.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(bad)
    return reply.send(await HousingService.storageTake((await me(req.authUser.userId)).id, parsed.data.code, parsed.data.amount))
  })

  // Туннель туда и обратно (правка 22.10): вышел туннелем — тем же вернёшься.
  fastify.post<{ Params: { code: string } }>('/tunnels/:code/go', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.enum(['pvp', 'industrial', 'farm']).safeParse(req.params.code)
    if (!parsed.success) return reply.code(422).send(bad)
    return reply.send(await HousingService.goThroughTunnel((await me(req.authUser.userId)).id, parsed.data))
  })
  fastify.get('/exit', { preHandler: authenticate }, async req => HousingService.exit((await me(req.authUser.userId)).id))
  fastify.post('/return', { preHandler: authenticate }, async req => HousingService.returnHome((await me(req.authUser.userId)).id))

  // Налёт: заявка, бой ровно через 72 часа, запись в нападение и оборону.
  fastify.post<{ Params: { id: string } }>('/:id/raid', { preHandler: authenticate }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(422).send(bad)
    return reply.code(201).send(await HousingService.fileRaid((await me(req.authUser.userId)).id, req.params.id))
  })
  fastify.post<{ Params: { raidId: string }; Body: { side: number } }>('/raids/:raidId/signup', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ side: z.union([z.literal(1), z.literal(2)]) }).safeParse(req.body)
    if (!z.string().uuid().safeParse(req.params.raidId).success || !parsed.success) return reply.code(422).send(bad)
    return reply.send(await HousingService.signupRaid((await me(req.authUser.userId)).id, req.params.raidId, parsed.data.side))
  })
  fastify.post<{ Params: { raidId: string } }>('/raids/:raidId/unsign', { preHandler: authenticate }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.raidId).success) return reply.code(422).send(bad)
    return reply.send(await HousingService.unsignRaid((await me(req.authUser.userId)).id, req.params.raidId))
  })
}
