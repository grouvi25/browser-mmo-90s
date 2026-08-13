import { prisma } from '../../shared/db/prisma'
export const ProductionRepository = {
  listActive: () => prisma.productionObject.findMany({ where: { isActive: true, status: 'ACTIVE' }, include: { equipment: true }, orderBy: [{ requiredProfessionLevel: 'asc' }, { code: 'asc' }] }),
  findActiveById: (id: string) => prisma.productionObject.findFirst({ where: { id, isActive: true, status: 'ACTIVE' }, include: { equipment: true } }),
}
