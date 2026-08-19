import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { CharactersRepository } from '../characters/characters.repository'
import { CROPS, FARM_BUILDINGS, type CropCode, type FarmBuildingCode } from './farm.formulas'
import { FarmService } from './farm.service'

const Id = z.string().uuid()

export async function farmRoutes(fastify: FastifyInstance) {
  const character = async (userId: string) => {
    const item = await CharactersRepository.findByUserId(userId)
    if (!item) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    return item
  }

  fastify.get('/', { preHandler: authenticate }, async (req, reply) => {
    const actor = await character(req.authUser.userId)
    return reply.send(await FarmService.list(actor.id))
  })

  fastify.post('/plots', { preHandler: authenticate }, async (req, reply) => {
    const actor = await character(req.authUser.userId)
    return reply.code(201).send(await FarmService.buyPlot(actor.id))
  })

  fastify.post<{ Params: { id: string }; Body: { cropCode: string } }>('/plots/:id/plant', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ cropCode: z.enum(Object.keys(CROPS) as [CropCode, ...CropCode[]]) }).safeParse(req.body)
    if (!Id.safeParse(req.params.id).success || !parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const actor = await character(req.authUser.userId)
    return reply.code(201).send(await FarmService.plant(actor.id, req.params.id, parsed.data.cropCode))
  })

  fastify.post<{ Params: { id: string } }>('/plots/:id/water', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const actor = await character(req.authUser.userId)
    return reply.send(await FarmService.water(actor.id, req.params.id))
  })

  fastify.post<{ Params: { id: string } }>('/plots/:id/harvest', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const actor = await character(req.authUser.userId)
    return reply.send(await FarmService.harvest(actor.id, req.params.id))
  })
  fastify.post<{ Params: { id: string }; Body: { type: string } }>('/plots/:id/building', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ type: z.enum(Object.keys(FARM_BUILDINGS) as [FarmBuildingCode, ...FarmBuildingCode[]]) }).safeParse(req.body)
    if (!Id.safeParse(req.params.id).success || !parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const actor = await character(req.authUser.userId)
    return reply.code(201).send(await FarmService.buyBuilding(actor.id, req.params.id, parsed.data.type))
  })

}
