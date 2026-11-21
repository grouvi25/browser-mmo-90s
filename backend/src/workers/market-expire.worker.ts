import { prisma } from '../shared/db/prisma'
import { withTransaction } from '../shared/db/transaction'
import { ResourcesService } from '../modules/resources/resources.service'

export async function runMarketExpire(): Promise<number> {
  const now = new Date()
  const due = await prisma.marketListing.findMany({
    where: { status: 'ACTIVE', expiresAt: { lte: now } }, select: { id: true }, take: 200,
  })
  let count = 0
  for (const { id } of due) {
    const done = await withTransaction(async tx => {
      const listing = await tx.marketListing.findUnique({ where: { id } })
      if (!listing || listing.status !== 'ACTIVE' || listing.expiresAt > now) return false
      const changed = await tx.marketListing.updateMany({
        where: { id, status: 'ACTIVE', revision: listing.revision, expiresAt: { lte: now } },
        data: { status: 'EXPIRED', revision: { increment: 1 } },
      })
      if (changed.count !== 1) return false
      if (listing.itemInstanceId) {
        await tx.itemInstance.updateMany({ where: { id: listing.itemInstanceId, status: 'ON_MARKET' }, data: { status: 'NORMAL' } })
      }
      if (listing.resourceTemplateId && listing.resourceAmount) {
        await ResourcesService.release(tx, listing.sellerCharacterId, listing.resourceTemplateId, listing.resourceAmount)
      }
      return true
    })
    if (done) count++
  }
  return count
}
export const MARKET_EXPIRE_MS=5*60*1000
