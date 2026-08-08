import { prisma } from '../../shared/db/prisma'
export const EconomyRepository = { prisma: () => prisma.currencyLog }
