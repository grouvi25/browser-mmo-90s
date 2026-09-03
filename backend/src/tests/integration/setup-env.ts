/**
 * Переменные окружения для интеграционного прогона.
 *
 * До этого файла тесты, которым нужен Redis, не запускались по одному: env.ts
 * требует JWT_SECRET, а брался он лишь из того, что какой-то из тестов
 * прогона выставил его раньше. Полный прогон проходил, одиночный падал —
 * то есть тест нельзя было воспроизвести отдельно, а именно это и нужно,
 * когда он красный.
 *
 * Значения из окружения имеют приоритет: DATABASE_URL, переданный командой,
 * не должен затираться рабочим из .env.
 */
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const file = resolve(__dirname, '../../../.env')
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const [, key, raw] = match
    if (process.env[key] !== undefined) continue
    process.env[key] = raw.trim().replace(/^["']|["']$/g, '')
  }
}
