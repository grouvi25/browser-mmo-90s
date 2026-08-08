import { prisma } from '../../shared/db/prisma'
export const ResourcesRepository = { prisma: () => prisma.resourceStack }
