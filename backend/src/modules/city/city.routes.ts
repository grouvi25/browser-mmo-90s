import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authenticate, requireAdminRole } from '../../shared/security/auth-middleware'
import { CityService } from './city.service'
import { AppError } from '../../shared/errors/app-error'
import { AdminActionsService } from '../admin-actions/admin-actions.service'
import { prisma } from '../../shared/db/prisma'

function key(req: FastifyRequest): string {
  const value = req.headers['idempotency-key']
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw AppError.validation('Требуется Idempotency-Key (8–128 символов)')
  return value
}
const codeSchema = z.object({ code: z.string().min(1).max(100) }).strict()
const kindSchema = z.enum(['tsum', 'berezka'])
export async function cityRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)
  const char = (req: FastifyRequest) => CityService.character(req.authUser.userId)
  app.get('/location', async req => CityService.location(req.authUser.userId))
  app.put('/location', async req => CityService.move(req.authUser.userId, z.object({ path: z.string().max(200) }).strict().parse(req.body).path))
  app.get('/professions', async req => CityService.professions((await char(req)).id))
  app.post('/professions', async req => CityService.learn((await char(req)).id, codeSchema.parse(req.body).code, key(req)))
  app.get<{ Params: { kind: string } }>('/shops/:kind', async req => CityService.catalog(kindSchema.parse(req.params.kind)))
  app.post<{ Params: { kind: string } }>('/shops/:kind/buy', async req => CityService.buyItem((await char(req)).id,
    kindSchema.parse(req.params.kind), z.object({ templateId: z.string().uuid() }).strict().parse(req.body).templateId, key(req)))
  app.get('/pets', async req => CityService.pets((await char(req)).id))
  app.post('/pets', async req => CityService.buyPet((await char(req)).id, codeSchema.parse(req.body).code, key(req)))
  app.post('/pets/food', async req => {
    const b = z.object({ petId: z.string().uuid(), pack: z.string().min(1).max(40) }).strict().parse(req.body)
    return CityService.buyFeedPack((await char(req)).id, b.petId, b.pack, key(req))
  })
  app.post('/pets/exchange', async req => CityService.exchangeLegacyPet((await char(req)).id, codeSchema.parse(req.body).code, key(req)))
  app.post('/pets/feed', async req => CityService.feed((await char(req)).id, z.object({ petId: z.string().uuid() }).strict().parse(req.body).petId, key(req)))
}
export async function cityAdminRoutes(app: FastifyInstance) {
  app.post('/prison', { preHandler: requireAdminRole('SUPER_ADMIN', 'MODERATOR') }, async req => {
    const b = z.object({ characterId: z.string().uuid(), hours: z.number().int().min(0).max(24 * 365), reason: z.string().trim().min(10).max(1000) }).strict().parse(req.body)
    const before = await prisma.character.findUnique({ where: { id: b.characterId } })
    if (!before) throw AppError.notFound('Персонаж')
    if (b.hours > 0 && before.status === 'IN_BATTLE') throw AppError.conflict('Дождитесь завершения боя перед заключением')
    const jailedUntil = b.hours ? new Date(Date.now() + b.hours * 3600000).toISOString() : null
    return AdminActionsService.perform({ adminId: req.adminUser.adminId, adminRole: req.adminUser.role }, b.reason, {
      kind: jailedUntil ? 'JAIL_CHARACTER' : 'RELEASE_CHARACTER', targetType: 'character', targetId: b.characterId,
      payload: { characterId: b.characterId, jailedUntil, jailReason: jailedUntil ? b.reason : null },
      undo: { kind: before.jailedUntil ? 'JAIL_CHARACTER' : 'RELEASE_CHARACTER', payload: {
        characterId: b.characterId, jailedUntil: before.jailedUntil?.toISOString() ?? null, jailReason: before.jailReason,
      } },
    })
  })
}
