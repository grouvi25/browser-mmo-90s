import 'dotenv/config'
import { buildApp, setupSocketIO } from './app'
import { connectDb, disconnectDb } from './shared/db/prisma'
import { disconnectRedis } from './shared/db/redis'
import { AppConfig } from './config/app.config'
import { logger } from './shared/logger/logger'

async function main() {
  logger.info('🚀 Starting MMO 90s backend...')

  // Connect DB
  await connectDb()
  logger.info('✅ PostgreSQL connected')

  // Build Fastify app
  const app = await buildApp()

  // Start server
  await app.listen({ port: AppConfig.server.port, host: AppConfig.server.host })
  logger.info(`✅ HTTP server listening on :${AppConfig.server.port}`)

  // Socket.io
  await setupSocketIO(app.server)
  logger.info('✅ Socket.io ready')

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`[${signal}] Shutting down...`)
    await app.close()
    await disconnectDb()
    await disconnectRedis()
    logger.info('Goodbye!')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error')
  process.exit(1)
})
