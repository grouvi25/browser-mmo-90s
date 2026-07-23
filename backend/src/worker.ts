/**
 * BullMQ Worker entry point
 * Handles async battle resolution, production cycles, farm timers, etc.
 * This runs as a separate process alongside the HTTP API.
 */
import { connectDb, disconnectDb } from './shared/db/prisma'
import { getRedis, disconnectRedis } from './shared/db/redis'
import { logger } from './shared/logger/logger'
import { runBattleCleanup } from './workers/battle-cleanup.worker'
import { runHpRecovery, TICK_MS as HP_TICK_MS } from './workers/hp-recovery.worker'
import { runBattleTimeout, TIMER_TICK_MS } from './workers/battle-timeout.worker'

async function startWorker(): Promise<void> {
  logger.info('🔧 Starting MMO 90s BullMQ workers...')

  await connectDb()
  logger.info('✅ PostgreSQL connected')

  const redis = getRedis()
  await redis.ping()
  logger.info('✅ Redis connected')

  // ─── Cron: Orphaned battles cleanup (every 5 minutes) ────────────────────
  const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

  const runCleanup = async () => {
    try {
      await runBattleCleanup()
    } catch (err) {
      logger.error({ err }, '[Worker] Battle cleanup error')
    }
  }

  // Run once on startup, then every 5 min
  await runCleanup()
  const cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS)
  logger.info('✅ Battle cleanup cron started (every 5 min)')

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

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`[${signal}] Worker shutting down...`)
    clearInterval(cleanupTimer)
    clearInterval(hpRecoveryTimer)
    clearInterval(battleTimeoutTimer)
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
