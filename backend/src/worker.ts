/**
 * BullMQ Worker entry point
 * Handles async battle resolution, production cycles, farm timers, etc.
 * This runs as a separate process alongside the HTTP API.
 */
import { connectDb, disconnectDb } from './shared/db/prisma'
import { getRedis, disconnectRedis } from './shared/db/redis'
import { logger } from './shared/logger/logger'
import { runBattleCleanup } from './workers/battle-cleanup.worker'
import { FarmService } from './modules/farm/farm.service'
import { runHpRecovery, TICK_MS as HP_TICK_MS } from './workers/hp-recovery.worker'
import { runBattleTimeout, TIMER_TICK_MS } from './workers/battle-timeout.worker'
import { runWorkShiftFinalize, WORK_SHIFT_FINALIZE_MS } from './workers/work-shift-finalize.worker'
import { runProductionCycle, PRODUCTION_CYCLE_MS } from './workers/production-cycle.worker'
import { runClanMaintenance, CLAN_MAINTENANCE_MS } from './workers/clan-maintenance.worker'
import { runAntiAbuse, ANTIABUSE_MS } from './workers/antiabuse.worker'
import { runTerritoryClaims, TERRITORY_CLAIMS_MS } from './workers/territory-claims.worker'
import { runMarketExpire, MARKET_EXPIRE_MS } from './workers/market-expire.worker'
import { runBattleApplications, BATTLE_APPLICATIONS_MS } from './modules/battles/applications.service'
import { runHouseSieges, HOUSE_SIEGES_MS } from './modules/clans/house-siege.service'
import { collectEconomyMetrics, startEconomyMetricsDaily } from './workers/economy-metrics-daily.worker'
import { cleanupExpiredIdempotencyKeys } from './shared/db/idempotency'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watchOverrides } from './modules/admin-balance/balance-overrides.service'

async function startWorker(): Promise<void> {
  logger.info('🔧 Starting MMO 90s BullMQ workers...')

  await connectDb()
  logger.info('✅ PostgreSQL connected')

  const redis = getRedis()
  await redis.ping()
  logger.info('✅ Redis connected')

  // ─── Cron: Orphaned battles cleanup (every minute) ───────────────────────
  // Раз в минуту, а не в пять: бой без состояния в Redis держит игрока на
  // экране боя, и каждая лишняя минута — это «я завис в бою».
  const CLEANUP_INTERVAL_MS = 60 * 1000

  const runCleanup = async () => {
    try {
      await runBattleCleanup()
    } catch (err) {
      logger.error({ err }, '[Worker] Battle cleanup error')
    }
  }

  // Run once on startup, then every minute
  await runCleanup()
  const cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS)
  logger.info('✅ Battle cleanup cron started (every 1 min)')

  // ─── Cron: HP recovery (every 10 seconds) ────────────────────────────────
  const hpRecoveryTimer = setInterval(async () => {
    try { await runHpRecovery() }
    catch (err) { logger.error({ err }, '[Worker] HP recovery error') }
  }, HP_TICK_MS)
  logger.info(`✅ HP recovery cron started (every ${HP_TICK_MS / 1000}s)`)

  // ─── Cron: Battle turn timeout (every 2 seconds) ──────────────────────────
  const battleTimeoutTimer = setInterval(async () => {
    try { await runBattleTimeout() }
    catch (err) { logger.error({ err }, '[Worker] Battle timeout error') }
  }, TIMER_TICK_MS)
  logger.info(`✅ Battle timeout cron started (every ${TIMER_TICK_MS / 1000}s, auto-block at 7s)`)

  // ─── Cron: рабочие фермы собирают созревший урожай (раз в минуту) ───────
  const farmWorkerTimer = setInterval(async () => {
    try { await FarmService.autoHarvest() }
    catch (err) { logger.error({ err }, '[Worker] Farm auto-harvest error') }
  }, 60_000)

  const workShiftTimer = setInterval(async () => {
    try { await runWorkShiftFinalize() }
    catch (err) { logger.error({ err }, '[Worker] Work shift finalize error') }
  }, WORK_SHIFT_FINALIZE_MS)

  const productionCycleTimer = setInterval(async () => {
    try { await runProductionCycle() }
    catch (err) { logger.error({ err }, '[Worker] Production cycle error') }
  }, PRODUCTION_CYCLE_MS)

  const clanMaintenanceTimer = setInterval(async () => {
    try { await runClanMaintenance() }
    catch (err) { logger.error({ err }, '[Worker] Clan maintenance error') }
  }, CLAN_MAINTENANCE_MS)

  // Заявки на территорию: раз в минуту назначить бой тем, чей час настал,
  // и разобрать исход тем, чей бой закончился.
  const territoryClaimsTimer = setInterval(async () => {
    try { await runTerritoryClaims() }
    catch (err) { logger.error({ err }, '[Worker] Territory claims error') }
  }, TERRITORY_CLAIMS_MS)

  // Антиабуз: раз в сутки пересобрать граф связей и прогнать детекторы.
  // Ничего не наказывает — поднимает сигналы для администратора.
  const antiAbuseTimer = setInterval(async () => {
    try { await runAntiAbuse() }
    catch (err) { logger.error({ err }, '[Worker] Antiabuse error') }
  }, ANTIABUSE_MS)

  // Заявки на бой: каждые 5 секунд открыть те, чьё время пришло.
  const battleApplicationsTimer = setInterval(async () => {
    try { await runBattleApplications() }
    catch (err) { logger.error({ err }, '[Worker] Battle applications error') }
  }, BATTLE_APPLICATIONS_MS)

  // Осады домов бригад: начать назначенные и подвести итог законченным.
  const houseSiegesTimer = setInterval(async () => {
    try { await runHouseSieges() }
    catch (err) { logger.error({ err }, '[Worker] House sieges error') }
  }, HOUSE_SIEGES_MS)

  const marketExpireTimer = setInterval(async () => {
    try { await runMarketExpire() }
    catch (err) { logger.error({ err }, '[Worker] Market expire error') }
  }, MARKET_EXPIRE_MS)

  const IDEMPOTENCY_CLEANUP_MS = 60 * 60 * 1000
  const runIdempotencyCleanup = async () => {
    try {
      const deleted = await cleanupExpiredIdempotencyKeys()
      if (deleted > 0) logger.info({ deleted }, '[Worker] Expired idempotency keys removed')
    } catch (err) {
      logger.error({ err }, '[Worker] Idempotency cleanup error')
    }
  }
  await runIdempotencyCleanup()
  const idempotencyCleanupTimer = setInterval(runIdempotencyCleanup, IDEMPOTENCY_CLEANUP_MS)

  // Воркер считает метрики и содержание по тем же коэффициентам, что и
  // сервер, — значит правки из админки обязан видеть и он.
  await watchOverrides()

  try { await collectEconomyMetrics() }
  catch (err) { logger.error({ err }, '[EconomyMetrics] Initial collection failed') }
  const stopEconomyMetrics = startEconomyMetricsDaily(4)
  logger.info('Economy metrics daily collector scheduled for 04:00 UTC')

  // os.tmpdir() resolves to /tmp on Linux (matches the healthcheck in
  // docker-compose.prod.yml) and to a real, existing directory on Windows -
  // a hardcoded '/tmp/...' default crashed the worker outright on local
  // Windows dev, since C:\tmp doesn't exist there.
  const heartbeatPath = process.env.WORKER_HEARTBEAT_PATH ?? join(tmpdir(), 'mmo90s-worker-heartbeat')
  const writeHeartbeat = () => writeFileSync(heartbeatPath, new Date().toISOString())
  writeHeartbeat()
  const heartbeatTimer = setInterval(writeHeartbeat, 10_000)

const shutdown = async (signal: string): Promise<void> => {
    logger.info(`[${signal}] Worker shutting down...`)
    clearInterval(cleanupTimer)
    clearInterval(farmWorkerTimer)
    clearInterval(hpRecoveryTimer)
    clearInterval(battleTimeoutTimer)
    clearInterval(workShiftTimer)
    clearInterval(productionCycleTimer)
    clearInterval(clanMaintenanceTimer)
    clearInterval(territoryClaimsTimer)
    clearInterval(antiAbuseTimer)
    clearInterval(marketExpireTimer)
    clearInterval(battleApplicationsTimer)
    clearInterval(houseSiegesTimer)
    clearInterval(idempotencyCleanupTimer)
    stopEconomyMetrics()
    clearInterval(heartbeatTimer)
    await disconnectDb()
    await disconnectRedis()
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
}

startWorker().catch((err) => {
  logger.error({ err }, 'Fatal worker startup error')
  process.exit(1)
})
