import type { FastifyInstance } from 'fastify'
import { authenticateAdmin } from '../../shared/security/auth-middleware'
import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { z } from 'zod'
import { EconomyService } from '../economy/economy.service'

const GrantMoneySchema = z.object({
  characterId: z.string().uuid(),
  amount: z.number().int().positive().max(1_000_000),
  reason: z.string().optional(),
})

const GrantItemSchema = z.object({
  characterId: z.string().uuid(),
  templateId: z.string().uuid(),
})

export async function adminBasicRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/admin/stats — общая статистика
  fastify.get('/stats', { preHandler: authenticateAdmin },
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
  fastify.get('/users', { preHandler: authenticateAdmin },
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
  fastify.get<{ Params: { id: string } }>('/characters/:id', { preHandler: authenticateAdmin },
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
  fastify.post('/grant-money', { preHandler: authenticateAdmin },
    async (req, reply) => {
      const parsed = GrantMoneySchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const { characterId, amount, reason } = parsed.data

      return withTransaction(async (tx) => {
        const char = await tx.character.findUnique({ where: { id: characterId } })
        if (!char) return reply.code(404).send({ code: 'GEN_002', message: 'Character not found' })

        const newBalance = await EconomyService.credit(tx, {
          characterId, amount, reasonCode: 'ADMIN_GRANT', note: reason ?? 'Admin grant',
        })
        return reply.send({ characterId, amount, newBalance })
      })
    })

  // POST /api/admin/grant-item — выдача предмета
  fastify.post('/grant-item', { preHandler: authenticateAdmin },
    async (req, reply) => {
      const parsed = GrantItemSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const { characterId, templateId } = parsed.data

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
            details: { templateName: template.name },
          },
        })
        return reply.code(201).send(item)
      })
    })

  // GET /api/admin/battles/:id — инфо о бое
  fastify.get<{ Params: { id: string } }>('/battles/:id', { preHandler: authenticateAdmin },
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
  fastify.get('/logs/currency', { preHandler: authenticateAdmin },
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
  fastify.get('/logs/items', { preHandler: authenticateAdmin },
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
