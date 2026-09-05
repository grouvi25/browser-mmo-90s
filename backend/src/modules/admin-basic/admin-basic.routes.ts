import type { FastifyInstance } from 'fastify'
import { requireAdminRole } from '../../shared/security/auth-middleware'
import { prisma } from '../../shared/db/prisma'
import { getEconomyMetricsHistory, getLatestEconomyMetrics } from '../../workers/economy-metrics-daily.worker'
import { BalanceSandboxSchema, simulateBalanceSandbox } from '../balance-sandbox/balance-sandbox.service'
import { CombatSandboxSchema, simulateCombat } from '../admin-balance/combat-sandbox.service'

const READ_ADMIN = { preHandler: requireAdminRole('SUPER_ADMIN', 'MODERATOR', 'SUPPORT') }

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

  // Мутации переехали в admin-actions (шаг G2 Этапа 5).
  //
  // Выдача денег и предметов, блокировка лота и снятие товара лавки теперь
  // идут через журнал с обратной операцией: `/characters/money`,
  // `/items/grant`, `/items/:id/delete`, `/listings/:id/lock`,
  // `/listings/:id/unlock`, `/shop-items/:id/deactivate`.
  //
  // Старые ручки удалены, а не оставлены рядом. Две двери к одному действию,
  // из которых одна ничего не записывает, делают правило «ничего без
  // причины» необязательным: достаточно постучать во вторую.

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

  // Ряд ежедневных снимков — то, на чём дашборд рисует динамику. Снимки уже
  // лежат в Redis сорок суток, отдельного хранилища заводить не нужно.
  fastify.get('/economy/history', READ_ADMIN, async (req, reply) => {
    const days = Number((req.query as { days?: string }).days ?? 30)
    return reply.send({ items: await getEconomyMetricsHistory(Number.isFinite(days) ? days : 30) })
  })

  // Песочница баланса под админским токеном. Считает та же функция, что и на
  // игровой ручке, — дублируется только дверь: у администратора свой токен, и
  // требовать от него ещё и игровой аккаунт ради симуляции неправильно.
  fastify.post('/balance/simulate', READ_ADMIN, async (req, reply) => {
    const parsed = BalanceSandboxSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten() })
    }
    return reply.send(simulateBalanceSandbox(parsed.data))
  })

  // Песочница боя: те же функции, что считают настоящую схватку.
  fastify.post('/sandbox/combat', READ_ADMIN, async (req, reply) => {
    const parsed = CombatSandboxSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten() })
    }
    return reply.send(simulateCombat(parsed.data))
  })

  // Справочник предметов: что вообще есть в игре и с какими числами.
  // Берётся из базы, а не из сида — на проде важно видеть то, что стоит
  // там, включая правки, сделанные после последнего посева.
  fastify.get('/sandbox/items', READ_ADMIN, async (_req, reply) => {
    const items = await prisma.itemTemplate.findMany({
      orderBy: [{ type: 'asc' }, { levelReq: 'asc' }, { priceBase: 'asc' }],
    })
    return reply.send({ items })
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

  fastify.get('/logs/resources', READ_ADMIN, async (_req, reply) => {
    return reply.send(await prisma.resourceLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }))
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