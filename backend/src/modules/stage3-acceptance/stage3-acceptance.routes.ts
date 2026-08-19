import type { FastifyInstance } from 'fastify'
import { prisma } from '../../shared/db/prisma'
import { authenticate } from '../../shared/security/auth-middleware'
import { stage3Verdicts } from './stage3-acceptance.formulas'

export async function stage3AcceptanceRoutes(fastify: FastifyInstance) {
  fastify.get('/', { preHandler: authenticate }, async (_req, reply) => {
    const staleAt = new Date(Date.now() - 49 * 3_600_000)
    const [recipes, farmCrops, barOffers, privateObjects, clans, brokenObjects, stuckCycles, frozenClans] = await Promise.all([
      prisma.productionRecipe.count({ where: { isActive: true } }),
      prisma.resourceTemplate.count({ where: { code: { in: ['res_greens','res_vegetables','res_hops','res_seeds','res_tobacco'] }, isActive: true } }),
      prisma.barOffer.count({ where: { isActive: true } }),
      prisma.productionObject.count({ where: { ownerType: 'PRIVATE' } }),
      prisma.clan.count(),
      prisma.productionObject.count({ where: { durabilityCurrent: { lt: 0 } } }),
      prisma.productionCycle.count({ where: { status: 'PENDING', createdAt: { lt: staleAt } } }),
      prisma.clan.count({ where: { isFrozen: true } }),
    ])
    const metrics = { recipes, farmCrops, barOffers, privateObjects, clans, brokenObjects, stuckCycles, frozenClans }
    const verdicts = stage3Verdicts(metrics)
    return reply.send({ checkedAt: new Date(), ready: Object.values(verdicts).every(Boolean), metrics, verdicts })
  })
}
