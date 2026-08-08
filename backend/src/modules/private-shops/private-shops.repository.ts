import { prisma } from '../../shared/db/prisma'
export const PrivateShopsRepository = { prisma: () => prisma.privateShopItem }
