import { prisma } from '../shared/db/prisma'
import { CLAN_FREEZE_DEBT, CLAN_MAINTENANCE_DAILY } from '../modules/clans/clans.formulas'
import {
  assignTiers, clanDailyUpkeep, shouldRelease, territoryUpkeepPerDay,
} from '../modules/territories/territories.formulas'

export const CLAN_MAINTENANCE_MS = 60 * 60 * 1000

const DAY_MS = 24 * 3_600_000

/**
 * Содержание клана и его территорий — одним списанием.
 *
 * Отдельного воркера под территории намеренно нет: и то и другое списывается
 * из одного общака, и два независимых процесса, дебетующих один счёт, — это
 * готовая гонка. Скидка Спального района к тому же действует на сумму обоих,
 * посчитать её можно только там, где известно и то и другое.
 *
 * ТЗ: docs/specs/stage-4/MASTER_TZ_STAGE_4_STRATEGY_PREMIUM_WAR.md, раздел 22.
 */
export async function runClanMaintenance(now = new Date()): Promise<number> {
  const dueAt = new Date(now.getTime() - DAY_MS)
  const clans = await prisma.clan.findMany({ where: { lastChargedAt: { lte: dueAt } }, take: 200 })
  let charged = 0

  for (const clan of clans) {
    const days = Math.max(1, Math.floor((now.getTime() - clan.lastChargedAt.getTime()) / DAY_MS))

    const territories = await prisma.territory.findMany({
      where: { ownerClanId: clan.id, status: 'CONTROLLED' },
      select: { id: true, code: true, bonusCode: true, bonusValue: true, controlledAt: true, upkeepDebt: true },
    })
    const tiers = assignTiers(territories)
    // Скидка берётся с самой территории, а не из константы: величина бонуса
    // живёт в данных, чтобы правка баланса не требовала выката.
    const discount = territories.find(item => item.bonusCode === 'UPKEEP_COST')
    const perDay = clanDailyUpkeep(
      CLAN_MAINTENANCE_DAILY,
      territories.map(item => tiers.get(item.id) ?? 1),
      !!discount,
      discount?.bonusValue ?? 0,
    )
    const cost = days * perDay
    const paid = Math.min(clan.treasury, cost)
    const debt = clan.maintenanceDebt + cost - paid

    // lastChargedAt двигается на фактически списанные сутки, а не на now:
    // иначе остаток часов прощался клану при каждом тике и содержание
    // тихо недобиралось. Дефект достался от Этапа 3, чинится здесь.
    const chargedUntil = new Date(clan.lastChargedAt.getTime() + days * DAY_MS)

    const updated = await prisma.clan.update({
      where: { id: clan.id },
      data: {
        treasury: { decrement: paid },
        maintenanceDebt: debt,
        isFrozen: debt >= CLAN_FREEZE_DEBT,
        lastChargedAt: chargedUntil,
      },
    })
    await prisma.clanTreasuryLog.create({
      data: { clanId: clan.id, amount: -cost, balanceAfter: updated.treasury, reason: 'MAINTENANCE' },
    })

    // Долг разносится по территориям поровну: он общий, но отключение бонуса
    // и потеря района решаются по каждой отдельно, и им нужен свой счётчик.
    if (territories.length > 0) {
      const share = Math.floor((cost - paid) / territories.length)
      for (const territory of territories) {
        const territoryDebt = territory.upkeepDebt + share
        if (shouldRelease(territoryDebt)) {
          // Район отпущен: долг по нему списывается вместе с ним, иначе клан
          // платил бы за то, чем уже не владеет.
          await prisma.territory.update({
            where: { id: territory.id },
            data: {
              status: 'NEUTRAL', ownerClanId: null, controlledAt: null,
              protectedUntil: null, upkeepDebt: 0, upkeepTier: 1,
            },
          })
        } else if (share > 0) {
          await prisma.territory.update({
            where: { id: territory.id },
            data: { upkeepDebt: territoryDebt },
          })
        }
      }
      // Ступени пересчитываются после возможной потери: клан, потерявший
      // первую территорию, платит за оставшуюся по первой ступени.
      await syncTiers(clan.id)
    }

    charged += 1
  }
  return charged
}

/** Ступени содержания по порядку захвата. Вызывается после смены состава. */
export async function syncTiers(clanId: string): Promise<void> {
  const owned = await prisma.territory.findMany({
    where: { ownerClanId: clanId, status: 'CONTROLLED' },
    select: { id: true, controlledAt: true, upkeepTier: true },
  })
  const tiers = assignTiers(owned)
  for (const territory of owned) {
    const tier = tiers.get(territory.id) ?? 1
    if (tier !== territory.upkeepTier) {
      await prisma.territory.update({ where: { id: territory.id }, data: { upkeepTier: tier } })
    }
  }
}

/** Суточный расход клана — для витрин и тестов, без списания. */
export async function clanUpkeepPreview(clanId: string): Promise<number> {
  const territories = await prisma.territory.findMany({
    where: { ownerClanId: clanId, status: 'CONTROLLED' },
    select: { id: true, bonusCode: true, bonusValue: true, controlledAt: true },
  })
  const tiers = assignTiers(territories)
  const discount = territories.find(item => item.bonusCode === 'UPKEEP_COST')
  return clanDailyUpkeep(
    CLAN_MAINTENANCE_DAILY,
    territories.map(item => tiers.get(item.id) ?? 1),
    !!discount,
    discount?.bonusValue ?? 0,
  )
}

export { territoryUpkeepPerDay }
