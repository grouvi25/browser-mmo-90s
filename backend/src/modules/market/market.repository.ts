import { prisma } from '../../shared/db/prisma'
export const MarketRepository = { prisma: () => prisma.marketListing }
