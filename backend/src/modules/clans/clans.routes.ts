import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { CharactersRepository } from '../characters/characters.repository'
import { ClansService } from './clans.service'
import { NoticesService } from '../chat/notices.service'
import { HouseSiegeService } from './house-siege.service'
import type { ClanPermission } from './clans.formulas'

const Id = z.string().uuid()
const Amount = z.number().int().positive()

export async function clansRoutes(fastify: FastifyInstance) {
  const character = async (userId: string) => {
    const item = await CharactersRepository.findByUserId(userId)
    if (!item) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    return item
  }
  fastify.get('/', { preHandler: authenticate }, async (_req, reply) => reply.send({ items: await ClansService.list() }))
  // Картинка иконки — без входа: <img> не умеет слать токен. Секрета в ней
  // нет, а адрес с версией кэшируется надолго.
  fastify.get<{ Params: { id: string } }>('/:id/icon', async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(404).send()
    const icon = await ClansService.icon(req.params.id)
    if (!icon) return reply.code(404).send()
    return reply.header('Content-Type', icon.mime).header('Cache-Control', 'public, max-age=31536000, immutable').send(icon.bytes)
  })
  fastify.put<{ Body: { dataUrl: string } }>('/icon', { preHandler: authenticate, bodyLimit: 200_000 }, async (req, reply) => {
    const parsed = z.object({ dataUrl: z.string().max(180_000) }).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Иконка слишком большая' })
    const actor = await character(req.authUser.userId)
    return reply.send(await ClansService.setIcon(actor.id, parsed.data.dataUrl))
  })
  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const clan = await ClansService.get(req.params.id)
    const actor = await character(req.authUser.userId)
    // Общак, склад, долги и отношения — внутреннее дело бригады. Раньше их
    // отдавали любому игроку по id; чужим — только то, что видно с улицы.
    if (actor.clanId !== clan.id) {
      return reply.send({
        id: clan.id, name: clan.name, tag: clan.tag, level: clan.level,
        memberCapacity: clan.memberCapacity,
        members: clan.members.map(member => ({ id: member.id, characterId: member.characterId, character: member.character, role: { name: member.role.name, rank: member.role.rank } })),
      })
    }
    return reply.send(clan)
  })

  // ── Дом бригады и осады (как захват замков в «Королях») ──
  fastify.get<{ Params: { id: string } }>('/:id/house', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const actor = await character(req.authUser.userId)
    return reply.send(await HouseSiegeService.view(actor.id, req.params.id))
  })
  fastify.post<{ Params: { id: string } }>('/:id/siege', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ startsAt: z.string().datetime() }).safeParse(req.body)
    if (!Id.safeParse(req.params.id).success || !parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Укажите дату и время начала осады' })
    const actor = await character(req.authUser.userId)
    return reply.code(201).send(await HouseSiegeService.file(actor.id, req.params.id, new Date(parsed.data.startsAt)))
  })
  for (const action of ['signup', 'unsign', 'cancel'] as const) {
    fastify.post<{ Params: { siegeId: string } }>(`/sieges/:siegeId/${action}`, { preHandler: authenticate }, async (req, reply) => {
      if (!Id.safeParse(req.params.siegeId).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const actor = await character(req.authUser.userId)
      return reply.send(await HouseSiegeService[action](actor.id, req.params.siegeId))
    })
  }
  fastify.post('/house/repair', { preHandler: authenticate }, async (req, reply) => {
    const actor = await character(req.authUser.userId)
    return reply.send(await HouseSiegeService.repair(actor.id))
  })
  fastify.post<{ Params: { id: string } }>('/:id/wall', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ text: z.string().min(1).max(500) }).safeParse(req.body)
    if (!Id.safeParse(req.params.id).success || !parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Напишите текст надписи' })
    const actor = await character(req.authUser.userId)
    return reply.code(201).send(await HouseSiegeService.writeOnWall(actor.id, req.params.id, parsed.data.text))
  })
  fastify.post<{ Body: { name: string; tag?: string } }>('/', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ name: z.string().trim().min(3).max(32), tag: z.string().trim().min(2).max(6).regex(/^[a-zA-Z0-9]+$/).optional() }).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const actor = await character(req.authUser.userId)
    return reply.code(201).send(await ClansService.create(actor.id, parsed.data.name, parsed.data.tag))
  })
  fastify.post<{ Body: { targetCharacterId?: string; nickname?: string } }>('/invite', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ targetCharacterId: Id.optional(), nickname: z.string().trim().min(2).max(30).optional() })
      .refine(v => !!v.targetCharacterId || !!v.nickname).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Укажите ник бойца' })
    const actor = await character(req.authUser.userId)
    const invited = await ClansService.invite(actor.id, { characterId: parsed.data.targetCharacterId, nickname: parsed.data.nickname })
    const targetId = invited.characterId
    if (targetId) void NoticesService.push(targetId, 'Вас приглашают в бригаду. Ответить можно в Домах бригад.')
    return reply.code(201).send(invited)
  })
  fastify.get('/invites/mine', { preHandler: authenticate }, async (req, reply) => {
    const actor = await character(req.authUser.userId); return reply.send({ items: await ClansService.myInvites(actor.id) })
  })
  fastify.post<{ Params: { inviteId: string } }>('/invites/:inviteId/decline', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.inviteId).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const actor = await character(req.authUser.userId); return reply.send(await ClansService.decline(actor.id, req.params.inviteId))
  })
  fastify.post<{ Params: { inviteId: string } }>('/invites/:inviteId/accept', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.inviteId).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const actor = await character(req.authUser.userId); return reply.send(await ClansService.accept(actor.id, req.params.inviteId))
  })
  fastify.post('/leave', { preHandler: authenticate }, async (req, reply) => { const actor = await character(req.authUser.userId); return reply.send(await ClansService.leave(actor.id)) })
  fastify.post<{ Body: { targetCharacterId: string } }>('/kick', { preHandler: authenticate }, async (req, reply) => {
    const parsed=z.object({targetCharacterId:Id}).safeParse(req.body); if(!parsed.success)return reply.code(422).send({code:'GEN_001',message:'Validation error'}); const actor=await character(req.authUser.userId); return reply.send(await ClansService.kick(actor.id,parsed.data.targetCharacterId))
  })
  fastify.patch<{ Body: { targetCharacterId: string; roleId: string } }>('/role', { preHandler: authenticate }, async (req, reply) => {
    const parsed=z.object({targetCharacterId:Id,roleId:Id}).safeParse(req.body); if(!parsed.success)return reply.code(422).send({code:'GEN_001',message:'Validation error'}); const actor=await character(req.authUser.userId); const done=await ClansService.assignRole(actor.id,parsed.data.targetCharacterId,parsed.data.roleId)
    // Игроку, которому сменили должность, приходит уведомление в чат.
    if (done.changed) {
      void NoticesService.push(parsed.data.targetCharacterId, `В бригаде «${done.clanName}» вам назначена должность: ${done.roleName}.`)
      void NoticesService.push(actor.id, `Вы назначили должность «${done.roleName}».`)
    }
    return reply.send(done)
  })
  fastify.post<{ Body: { amount: number } }>('/treasury/deposit', { preHandler: authenticate }, async (req, reply) => {
    const parsed=z.object({amount:Amount}).safeParse(req.body); if(!parsed.success)return reply.code(422).send({code:'GEN_001',message:'Validation error'}); const actor=await character(req.authUser.userId); return reply.send(await ClansService.depositTreasury(actor.id,parsed.data.amount))
  })
  fastify.post<{ Body: { amount: number; reason: string } }>('/treasury/spend', { preHandler: authenticate }, async (req, reply) => {
    const parsed=z.object({amount:Amount,reason:z.string().trim().min(3).max(200)}).safeParse(req.body); if(!parsed.success)return reply.code(422).send({code:'GEN_001',message:'Validation error'}); const actor=await character(req.authUser.userId); return reply.send(await ClansService.spendTreasury(actor.id,parsed.data.amount,parsed.data.reason))
  })
  fastify.get<{ Querystring: { page?: string } }>('/storage/log', { preHandler: authenticate }, async (req, reply) => {
    const page = z.coerce.number().int().min(1).max(100_000).catch(1).parse(req.query.page)
    const actor = await character(req.authUser.userId)
    return reply.send(await ClansService.storageLog(actor.id, page))
  })
  fastify.post<{ Body: { resourceCode: string; amount: number } }>('/storage/deposit', { preHandler: authenticate }, async (req, reply) => {
    const parsed=z.object({resourceCode:z.string().min(1),amount:Amount}).safeParse(req.body); if(!parsed.success)return reply.code(422).send({code:'GEN_001',message:'Validation error'}); const actor=await character(req.authUser.userId); return reply.send(await ClansService.depositStorage(actor.id,parsed.data.resourceCode,parsed.data.amount))
  })
  fastify.post<{ Body: { resourceCode: string; amount: number } }>('/storage/withdraw', { preHandler: authenticate }, async (req, reply) => {
    const parsed=z.object({resourceCode:z.string().min(1),amount:Amount}).safeParse(req.body); if(!parsed.success)return reply.code(422).send({code:'GEN_001',message:'Validation error'}); const actor=await character(req.authUser.userId); return reply.send(await ClansService.withdrawStorage(actor.id,parsed.data.resourceCode,parsed.data.amount))
  })
  fastify.put<{ Params: { targetClanId: string }; Body: { type: 'ALLIANCE'|'HOSTILITY' } }>('/relations/:targetClanId', { preHandler: authenticate }, async (req, reply) => {
    const parsed=z.object({type:z.enum(['ALLIANCE','HOSTILITY'])}).safeParse(req.body); if(!Id.safeParse(req.params.targetClanId).success||!parsed.success)return reply.code(422).send({code:'GEN_001',message:'Validation error'}); const actor=await character(req.authUser.userId); return reply.send(await ClansService.setRelation(actor.id,req.params.targetClanId,parsed.data.type))
  })
  fastify.patch<{ Params: { roleId: string }; Body: { name: string; permissions: ClanPermission[] } }>('/roles/:roleId', { preHandler: authenticate }, async (req, reply) => {
    const allowed = ['INVITE','KICK','ASSIGN_ROLE','STORAGE_PUT','STORAGE_TAKE','TREASURY_PUT','TREASURY_SPEND','RELATIONS','OBJECTS','EDIT'] as const
    const parsed = z.object({ name: z.string().trim().min(2).max(24), permissions: z.array(z.enum(allowed)).max(allowed.length) }).safeParse(req.body)
    if (!Id.safeParse(req.params.roleId).success || !parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const actor = await character(req.authUser.userId)
    return reply.send(await ClansService.updateRole(actor.id, req.params.roleId, parsed.data.name, parsed.data.permissions))
  })

}
