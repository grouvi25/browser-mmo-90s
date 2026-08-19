import { ProductionRepository } from './production.repository'
import { ProductionErrors } from './production.errors'
import { prisma } from '../../shared/db/prisma'
import { RecipeService } from './recipe.service'
import { CycleService } from './cycle.service'
export const ProductionService = {
  list: async () => ({ items: await ProductionRepository.listActive() }),
  get: async (id: string) => { const item = await ProductionRepository.findActiveById(id); if (!item) throw ProductionErrors.notFound(); return item },
  recipes: (objectCode: string, characterId: string) => RecipeService.listForObject(objectCode, characterId),
  startCycle: (objectId: string) => CycleService.tryStart(objectId),
  cycles: (objectId: string, limit = 20) => prisma.productionCycle.findMany({
    where: { productionObjectId: objectId },
    include: { recipe: true, contributions: true, inputReservations: true },
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, Math.max(1, limit)),
  }),
}
