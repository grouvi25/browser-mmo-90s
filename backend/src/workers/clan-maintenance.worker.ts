import { prisma } from '../shared/db/prisma'
import { CLAN_FREEZE_DEBT, CLAN_MAINTENANCE_DAILY } from '../modules/clans/clans.formulas'

export const CLAN_MAINTENANCE_MS = 60 * 60 * 1000

export async function runClanMaintenance(now = new Date()): Promise<number> {
  const dueAt = new Date(now.getTime() - 24 * 3_600_000)
  const clans = await prisma.clan.findMany({ where: { lastChargedAt: { lte: dueAt } }, take: 200 })
  let charged = 0
  for (const clan of clans) {
    const days = Math.max(1, Math.floor((now.getTime() - clan.lastChargedAt.getTime()) / (24 * 3_600_000)))
    const cost = days * CLAN_MAINTENANCE_DAILY
    const paid = Math.min(clan.treasury, cost)
    const debt = clan.maintenanceDebt + cost - paid
    const updated = await prisma.clan.update({ where: { id: clan.id }, data: { treasury: { decrement: paid }, maintenanceDebt: debt, isFrozen: debt >= CLAN_FREEZE_DEBT, lastChargedAt: now } })
    await prisma.clanTreasuryLog.create({ data: { clanId: clan.id, amount: -cost, balanceAfter: updated.treasury, reason: 'MAINTENANCE' } })
    charged += 1
  }
  return charged
}
