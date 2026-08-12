import type { FastifyInstance } from 'fastify'
import { requireAdminRole } from '../../shared/security/auth-middleware'
import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { z } from 'zod'
import { EconomyService } from '../economy/economy.service'
import { getLatestEconomyMetrics } from '../../workers/economy-metrics-daily.worker'
import { audit } from '../../shared/logger/audit-logger'

const READ_ADMIN = { preHandler: requireAdminRole('SUPER_ADMIN', 'MODERATOR', 'SUPPORT') }
const MODERATE_ADMIN = { preHandler: requireAdminRole('SUPER_ADMIN', 'MODERATOR') }
const SUPER_ADMIN = { preHandler: requireAdminRole('SUPER_ADMIN') }
const ReasonSchema = z.string().trim().min(3).max(500)
const ModerationReasonSchema = z.object({ reason: ReasonSchema })

const GrantMoneySchema = z.object({
  characterId: z.string().uuid(),
  amount: z.number().int().positive().max(1_000_000),
  reason: ReasonSchema,
})

const GrantItemSchema = z.object({
  characterId: z.string().uuid(),
  templateId: z.string().uuid(),
  reason: ReasonSchema,
})

export async function adminBasicRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/admin/stats — общая статистика
  fastify.get('/stats', READ_ADMIN,
    async (_req, reply) => {
      const [users, characters, battles, items] = await Promise.all([
        prisma.user.count(),
        prisma.character.count(),
        prisma.battle.count(),
        prisma.itemInstance.count({ where: { status: { not: 'DELETED' } } }),
      ])
      return reply.send({ users, characters, battles, items })
    })

  // GET /api/admin/users?login=xxx — поиск пользователя
  fastify.get('/users', READ_ADMIN,
    async (req, reply) => {
      const query = (req.query as { login?: string }).login
      const users = await prisma.user.findMany({
        where: query ? { login: { contains: query } } : {},
        take: 20,
        orderBy: { registeredAt: 'desc' },
        select: {
          id: true, login: true, email: true, status: true,
          registeredAt: true, lastLoginAt: true, lastIp: true,
        },
      })
      return reply.send(users)
    })

  // GET /api/admin/characters/:id — инфо о персонаже
  fastify.get<{ Params: { id: string } }>('/characters/:id', READ_ADMIN,
    async (req, reply) => {
      const char = await prisma.character.findUnique({
        where: { id: req.params.id },
        include: {
          stats: true,
          weaponSkills: true,
          currencyLogs: { take: 10, orderBy: { createdAt: 'desc' } },
          repairLogs:   { take: 10, orderBy: { repairedAt: 'desc' } },
        },
      })
      if (!char) return reply.code(404).send({ code: 'GEN_002', message: 'Character not found' })
      return reply.send(char)
    })

  // POST /api/admin/grant-money — выдача денег
  fastify.post('/grant-money', SUPER_ADMIN,
    async (req, reply) => {
      const parsed = GrantMoneySchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const { characterId, amount, reason } = parsed.data

      return withTransaction(async (tx) => {
        const char = await tx.character.findUnique({ where: { id: characterId } })
        if (!char) return reply.code(404).send({ code: 'GEN_002', message: 'Character not found' })

        const newBalance = await EconomyService.credit(tx, {
          characterId, amount, reasonCode: 'ADMIN_GRANT', note: reason,
        })
        audit('admin.action', { action: 'grant_money', adminId: req.adminUser.adminId, targetCharacterId: characterId, amount, reason, newBalance })
        return reply.send({ characterId, amount, newBalance })
      })
    })

  // POST /api/admin/grant-item — выдача предмета
  fastify.get('/economy/overview', READ_ADMIN, async (_req, reply) => {
    const [money, activeListings, activeShifts, resourceStacks, upgrades] = await Promise.all([
      prisma.character.aggregate({ _sum: { money: true }, _count: true }),
      prisma.marketListing.count({ where: { status: { in: ['ACTIVE', 'LOCKED'] } } }),
      prisma.workShift.count({ where: { status: { in: ['ACTIVE', 'READY_TO_CLAIM'] } } }),
      prisma.resourceStack.aggregate({ _sum: { amount: true, reservedAmount: true } }),
      prisma.upgradeLog.groupBy({ by: ['result'], _count: true }),
    ])
    const latestMetrics = await getLatestEconomyMetrics()
    return reply.send({ m2Total: money._sum.money ?? 0, characters: money._count, activeListings, activeShifts, resources: resourceStacks._sum, upgrades, latestMetrics })
  })

  fastify.get('/work/shifts', READ_ADMIN, async (req, reply) => {
    const { status, limit } = req.query as { status?: string; limit?: string }
    const statuses = ['ACTIVE','READY_TO_CLAIM','CLAIMED','CANCELLED','FAILED'] as const
    const selected = statuses.find(value => value === status)
    return reply.send({ items: await prisma.workShift.findMany({ where: selected ? { status: selected } : {}, include: { productionObject: true, character: { select: { id: true, nickname: true } } }, orderBy: { createdAt: 'desc' }, take: Math.min(100, Math.max(1, Number(limit ?? 50))) }) })
  })

  fastify.get('/market/listings', READ_ADMIN, async (req, reply) => {
    const { status, limit } = req.query as { status?: string; limit?: string }
    const statuses = ['ACTIVE','LOCKED','SOLD','CANCELLED','EXPIRED'] as const
    const selected = statuses.find(value => value === status)
    return reply.send({ items: await prisma.marketListing.findMany({ where: selected ? { status: selected } : {}, orderBy: { createdAt: 'desc' }, take: Math.min(100, Math.max(1, Number(limit ?? 50))) }) })
  })

  fastify.post<{ Params: { id: string } }>('/private-shops/items/:id/deactivate', MODERATE_ADMIN, async (req, reply) => {
    const parsed = ModerationReasonSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Reason is required' })
    const changed = await prisma.privateShopItem.updateMany({ where: { id: req.params.id, isActive: true }, data: { isActive: false } })
    if (changed.count !== 1) return reply.code(404).send({ code: 'PSHOP_001', message: 'Private shop item not found or inactive' })
    audit('admin.action', { action: 'private_shop_item_deactivated', adminId: req.adminUser.adminId, privateShopItemId: req.params.id, reason: parsed.data.reason })
    return reply.send({ privateShopItemId: req.params.id, isActive: false })
  })

  fastify.get('/logs/resources', READ_ADMIN, async (_req, reply) => {
    return reply.send(await prisma.resourceLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }))
  })

  fastify.post<{ Params: { id: string } }>('/market/listings/:id/lock', MODERATE_ADMIN, async (req, reply) => {
    const parsed = ModerationReasonSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Reason is required' })
    const changed = await prisma.marketListing.updateMany({ where: { id: req.params.id, status: 'ACTIVE' }, data: { status: 'LOCKED' } })
    if (changed.count !== 1) return reply.code(409).send({ code: 'MARKET_002', message: 'Listing cannot be locked' })
    audit('admin.action', { action: 'market_listing_locked', adminId: req.adminUser.adminId, listingId: req.params.id, before: 'ACTIVE', after: 'LOCKED', reason: parsed.data.reason })
    return reply.send({ listingId: req.params.id, status: 'LOCKED' })
  })

  fastify.post<{ Params: { id: string } }>('/market/listings/:id/unlock', MODERATE_ADMIN, async (req, reply) => {
    const parsed = ModerationReasonSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Reason is required' })
    const changed = await prisma.marketListing.updateMany({ where: { id: req.params.id, status: 'LOCKED' }, data: { status: 'ACTIVE' } })
    if (changed.count !== 1) return reply.code(409).send({ code: 'MARKET_002', message: 'Listing cannot be unlocked' })
    audit('admin.action', { action: 'market_listing_unlocked', adminId: req.adminUser.adminId, listingId: req.params.id, before: 'LOCKED', after: 'ACTIVE', reason: parsed.data.reason })
    return reply.send({ listingId: req.params.id, status: 'ACTIVE' })
  })

  fastify.post('/grant-item', SUPER_ADMIN,
    async (req, reply) => {
      const parsed = GrantItemSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const { characterId, templateId, reason } = parsed.data

      const template = await prisma.itemTemplate.findUnique({ where: { id: templateId } })
      if (!template) return reply.code(404).send({ code: 'GEN_002', message: 'Template not found' })

      return withTransaction(async (tx) => {
        const item = await tx.itemInstance.create({
          data: {
            templateId, ownerId: characterId,
            quality: template.qualityBase,
            durabilityCurrent: template.durabilityMax,
            durabilityMax: template.durabilityMax,
            weight: template.weight,
            sourceType: 'ADMIN',
          },
        })
        await tx.itemLog.create({
          data: {
            itemId: item.id, characterId,
            actionCode: 'CREATED_BY_ADMIN',
            details: { templateName: template.name, reason, adminId: req.adminUser.adminId },
          },
        })
        audit('admin.action', { action: 'grant_item', adminId: req.adminUser.adminId, targetCharacterId: characterId, templateId, itemId: item.id, reason })
        return reply.code(201).send(item)
      })
    })

  // GET /api/admin/battles/:id — инфо о бое
  fastify.get<{ Params: { id: string } }>('/battles/:id', READ_ADMIN,
    async (req, reply) => {
      const battle = await prisma.battle.findUnique({
        where: { id: req.params.id },
        include: {
          participants: true,
          turns: { orderBy: { roundNumber: 'asc' } },
        },
      })
      if (!battle) return reply.code(404).send({ code: 'GEN_002', message: 'Battle not found' })
      return reply.send(battle)
    })

  // GET /api/admin/logs/currency?characterId=xxx
  fastify.get('/logs/currency', READ_ADMIN,
    async (req, reply) => {
      const { characterId, limit } = req.query as { characterId?: string; limit?: string }
      const logs = await prisma.currencyLog.findMany({
        where: characterId ? { characterId } : {},
        take: Number(limit ?? 50),
        orderBy: { createdAt: 'desc' },
      })
      return reply.send(logs)
    })

  // GET /api/admin/logs/items?characterId=xxx
  fastify.get('/logs/items', READ_ADMIN,
    async (req, reply) => {
      const { characterId, limit } = req.query as { characterId?: string; limit?: string }
      const logs = await prisma.itemLog.findMany({
        where: characterId ? { characterId } : {},
        take: Number(limit ?? 50),
        orderBy: { createdAt: 'desc' },
      })
      return reply.send(logs)
    })
}