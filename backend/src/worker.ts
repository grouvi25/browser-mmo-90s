/**
 * BullMQ Worker entry point
 * Handles async battle resolution, production cycles, farm timers, etc.
 * This runs as a separate process alongside the HTTP API.
 */
import { connectDb, disconnectDb } from './shared/db/prisma'
import { getRedis, disconnectRedis } from './shared/db/redis'
import { logger } from './shared/logger/logger'

// TODO: Import and register queue processors as they're implemented
// import { registerBattleWorkers } from './workers/battle.worker'
// import { registerProductionWorkers } from './workers/production.worker'

async function startWorker(): Promise<void> {
  logger.info('🔧 Starting MMO 90s BullMQ workers...')

  await connectDb()
  logger.info('✅ PostgreSQL connected')

  // Ensure Redis is accessible
  const redis = getRedis()
  await redis.ping()
  logger.info('✅ Redis connected')

  // TODO: Register BullMQ queue workers here as they're implemented
  // registerBattleWorkers()
  // registerProductionWorkers()

  logger.info('✅ Workers ready (Phase 1: placeholder — battle workers coming in next iteration)')

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`[${signal}] Worker shutting down...`)
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
