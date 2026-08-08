import { prisma } from '../../shared/db/prisma'
export const UpgradesRepository = { prisma: () => prisma.upgradeLog }
