import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV:         z.enum(['development', 'production', 'test']).default('development'),
  PORT:             z.coerce.number().default(4000),
  APP_URL:          z.string().url().default('http://localhost:3000'),
  API_URL:          z.string().url().default('http://localhost:4000'),

  JWT_SECRET:       z.string().min(32),
  JWT_EXPIRES_IN:   z.string().default('7d'),

  DATABASE_URL:     z.string().min(1),
  REDIS_URL:        z.string().default('redis://localhost:6379'),

  LOG_LEVEL:        z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  BCRYPT_ROUNDS:    z.coerce.number().default(10),
  CORS_ORIGIN:      z.string().default('http://localhost:3000'),

  // Worker mode flag
  WORKER_MODE:      z.string().optional().transform(v => v === 'true'),
})

function loadEnv() {
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    console.error('❌ Invalid environment variables:')
    console.error(parsed.error.flatten().fieldErrors)
    process.exit(1)
  }
  return parsed.data
}

export const env = loadEnv()
export type Env = typeof env
