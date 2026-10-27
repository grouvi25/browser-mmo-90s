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

  // Оповещения в Telegram. Необязательны: без них всё работает как
  // раньше, алерты просто остаются в админке. Токен живёт только в
  // окружении — ни в базе, ни в ответах API его нет, иначе доступ к
  // админке означал бы и доступ к боту.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID:   z.string().optional(),

  // Почта игры (noreply@kooperativ.space на Beget): письма со ссылкой на
  // новый пароль. Необязательна: без неё ссылка уходит в бот администрации.
  SMTP_HOST:          z.string().optional(),
  SMTP_PORT:          z.coerce.number().int().default(465),
  SMTP_USER:          z.string().optional(),
  SMTP_PASS:          z.string().optional(),
  MAIL_FROM:          z.string().email().optional(),
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
