import { prisma } from '../../shared/db/prisma'
export const ProductionRepository = {
  listActive: () => prisma.productionObject.findMany({ where: { isActive: true, status: 'ACTIVE' }, include: { equipment: true, inventory: true, cycles: { where: { status: { in: ['PENDING', 'RUNNING'] } }, include: { recipe: true }, take: 1 } }, orderBy: [{ requiredProfessionLevel: 'asc' }, { code: 'asc' }] }),
  findActiveById: (id: string) => prisma.productionObject.findFirst({ where: { id, isActive: true, status: 'ACTIVE' }, include: { equipment: true, inventory: true, cycles: { where: { status: { in: ['PENDING', 'RUNNING'] } }, include: { recipe: true }, take: 1 } } }),
}
