// NOTE: In production (Docker), env vars are set via docker-compose env_file
import cluster from 'cluster'
import os from 'os'
import { buildApp, setupSocketIO } from './app'
import { connectDb, disconnectDb } from './shared/db/prisma'
import { disconnectRedis } from './shared/db/redis'
import { AppConfig } from './config/app.config'
import { logger } from './shared/logger/logger'
import { watchOverrides } from './modules/admin-balance/balance-overrides.service'

// Increase libuv thread pool for native bcrypt + filesystem ops.
// Default is 4; with clustering each worker gets its own pool.
// Импорты вычисляются раньше тела модуля, поэтому значение выставляется
// до любой асинхронной работы — как и требовалось.
process.env.UV_THREADPOOL_SIZE = String(Math.max(8, os.cpus().length * 2))

const CLUSTER_MODE = process.env.NODE_CLUSTER === 'true'
const NUM_WORKERS  = parseInt(process.env.NODE_WORKERS ?? '0') || os.cpus().length

// ---------------------------------------------------------------
// Cluster primary: fork workers
// ---------------------------------------------------------------
if (CLUSTER_MODE && cluster.isPrimary) {
  logger.info(`🚀 Primary ${process.pid} starting ${NUM_WORKERS} workers...`)

  for (let i = 0; i < NUM_WORKERS; i++) {
    cluster.fork()
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.warn(`Worker ${worker.process.pid} died (${signal ?? code}). Restarting...`)
    cluster.fork()
  })

} else {
  // Worker process (or no cluster mode)
  startServer()
}

async function startServer() {
  logger.info(`🔧 Worker ${process.pid} starting...`)

  await connectDb()
  logger.info('✅ PostgreSQL connected')

  // Правки коэффициентов из админки живут в базе и накладываются на
  // BalanceConfig в памяти. Подписка нужна каждому процессу отдельно:
  // память у них своя, и правка в одном без этого не видна другому.
  await watchOverrides()

  const app = await buildApp()

  await app.listen({ port: AppConfig.server.port, host: AppConfig.server.host })
  logger.info(`✅ HTTP server on :${AppConfig.server.port} (worker ${process.pid})`)

  await setupSocketIO(app)
  logger.info('✅ Socket.io ready')

  const shutdown = async (signal: string) => {
    logger.info(`[${signal}] Worker ${process.pid} shutting down...`)
    await app.close()
    await disconnectDb()
    await disconnectRedis()
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
}
