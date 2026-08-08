import { ProductionRepository } from './production.repository'
import { ProductionErrors } from './production.errors'
export const ProductionService = {
  list: async () => ({ items: await ProductionRepository.listActive() }),
  get: async (id: string) => { const item = await ProductionRepository.findActiveById(id); if (!item) throw ProductionErrors.notFound(); return item },
}
