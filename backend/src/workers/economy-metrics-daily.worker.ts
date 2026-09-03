import { BalanceConfig } from '../config/balance.config'
import { prisma } from '../shared/db/prisma'
import { getRedis } from '../shared/db/redis'
import { logger } from '../shared/logger/logger'
import { gini, isShiftReadyLagging, median, msUntilNextUtcHour, workToolBlockedKey } from './economy-metrics.formulas'

const DAY_MS = 24 * 60 * 60 * 1000
const SNAPSHOT_TTL_SECONDS = 40 * 24 * 60 * 60

export type EconomyMetricsSnapshot = {
  date: string
  generatedAt: string
  m2: number
  characters: number
  gini: number
  faucets: number
  sinks: number
  netEmission: number
  sinkShare: number
  m2Growth: number | null
  activeListings: number
  medianListingPrice: number
  completedShifts: number
  shiftReadyLagMedianSeconds: number | null
  tools: { usesConsumed: number; missingToolBlocks: number }
  upgrades: { total: number; successful: number; successRate: number }
  alerts: string[]
}

export function economyMetricsKey(date: string): string {
  return `economy:metrics:${date}`
}

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function collectEconomyMetrics(now = new Date()): Promise<EconomyMetricsSnapshot> {
  const end = now
  const start = new Date(end.getTime() - DAY_MS)
  const date = utcDate(end)
  const previousDate = utcDate(new Date(end.getTime() - DAY_MS))

  const [characters, currency, listings, completedShifts, toolUsesConsumed, upgrades, previousRaw, missingToolBlocksRaw, readyLagRows] = await Promise.all([
    prisma.character.findMany({ select: { money: true } }),
    prisma.currencyLog.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { amount: true } }),
    prisma.marketListing.findMany({ where: { status: 'ACTIVE' }, select: { price: true } }),
    prisma.workShift.count({ where: { status: 'CLAIMED', claimedAt: { gte: start, lt: end } } }),
    prisma.itemLog.count({ where: { actionCode: 'TOOL_USE', createdAt: { gte: start, lt: end } } }),
    prisma.upgradeLog.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { result: true } }),
    getRedis().get(economyMetricsKey(previousDate)),
    getRedis().get(workToolBlockedKey(date)),
    prisma.$queryRaw<Array<{ median_seconds: number | null }>>`
      SELECT percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (pl.created_at - ws.ends_at))
             ) AS median_seconds
        FROM production_logs pl
        -- work_shifts.id — обычный Prisma String (в базе text, не uuid),
        -- ->> тоже отдаёт text: сравнение с явным ::uuid справа падало
        -- "оператор не существует: text = uuid" при каждом сборе метрик.
        JOIN work_shifts ws ON ws.id = (pl.metadata_json ->> 'shiftId')
       WHERE pl.event_type = 'SHIFT_READY'
         AND pl.created_at >= ${start}
         AND pl.created_at < ${end}
    `,
  ])

  const m2 = characters.reduce((sum, character) => sum + character.money, 0)
  const faucets = currency.reduce((sum, entry) => sum + Math.max(0, entry.amount), 0)
  const sinks = currency.reduce((sum, entry) => sum + Math.max(0, -entry.amount), 0)
  const successful = upgrades.filter(entry => entry.result === 'SUCCESS').length
  const previous = previousRaw ? JSON.parse(previousRaw) as EconomyMetricsSnapshot : null
  const m2Growth = previous && previous.m2 > 0 ? (m2 - previous.m2) / previous.m2 : null
  const sinkShare = sinks / Math.max(1, faucets)
  const successRate = successful / Math.max(1, upgrades.length)
  const shiftReadyLagMedianSeconds = readyLagRows[0]?.median_seconds === null || readyLagRows[0]?.median_seconds === undefined
    ? null
    : Number(readyLagRows[0].median_seconds)
  const cfg = BalanceConfig.economy.alerts
  const alerts: string[] = []
  if (sinkShare < cfg.minSinkShare) alerts.push('LOW_SINK_SHARE')
  if (m2Growth !== null && m2Growth > cfg.maxDailyM2Growth) alerts.push('HIGH_M2_GROWTH')
  if (gini(characters.map(character => character.money)) > cfg.maxGini) alerts.push('HIGH_MONEY_GINI')
  if (upgrades.length >= cfg.minUpgradeSample && (successRate < cfg.minUpgradeSuccessRate || successRate > cfg.maxUpgradeSuccessRate)) alerts.push('UPGRADE_SUCCESS_OUT_OF_RANGE')
  if (isShiftReadyLagging(shiftReadyLagMedianSeconds)) alerts.push('SHIFT_READY_LAG_HIGH')

  const snapshot: EconomyMetricsSnapshot = {
    date,
    generatedAt: now.toISOString(),
    m2,
    characters: characters.length,
    gini: gini(characters.map(character => character.money)),
    faucets,
    sinks,
    netEmission: faucets - sinks,
    sinkShare,
    m2Growth,
    activeListings: listings.length,
    medianListingPrice: median(listings.map(listing => listing.price)),
    completedShifts,
    shiftReadyLagMedianSeconds,
    tools: { usesConsumed: toolUsesConsumed, missingToolBlocks: Number(missingToolBlocksRaw ?? 0) },
    upgrades: { total: upgrades.length, successful, successRate },
    alerts,
  }

  await getRedis().setex(economyMetricsKey(date), SNAPSHOT_TTL_SECONDS, JSON.stringify(snapshot))
  logger.info({ economyMetrics: snapshot }, '[EconomyMetrics] Daily snapshot stored')
  for (const alert of alerts) logger.warn({ alert, date, snapshot }, '[EconomyMetrics] Alert')
  return snapshot
}

export async function getLatestEconomyMetrics(now = new Date()): Promise<EconomyMetricsSnapshot | null> {
  const raw = await getRedis().get(economyMetricsKey(utcDate(now)))
  return raw ? JSON.parse(raw) as EconomyMetricsSnapshot : null
}

export function startEconomyMetricsDaily(hourUtc = 3): () => void {
  let timer: NodeJS.Timeout | null = null
  let stopped = false
  const schedule = () => {
    if (stopped) return
    timer = setTimeout(async () => {
      try { await collectEconomyMetrics() }
      catch (err) { logger.error({ err }, '[EconomyMetrics] Collection failed') }
      schedule()
    }, msUntilNextUtcHour(new Date(), hourUtc))
    timer.unref()
  }
  schedule()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
