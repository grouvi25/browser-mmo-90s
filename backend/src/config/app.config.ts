import { env } from './env'

export const AppConfig = {
  server: {
    port: env.PORT,
    host: '0.0.0.0',
    appUrl: env.APP_URL,
    apiUrl: env.API_URL,
    corsOrigin: env.CORS_ORIGIN,
  },
  logger: {
    level: env.LOG_LEVEL,
  },
} as const
