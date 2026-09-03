/**
 * Применить индексы, которых нет в schema.prisma.
 *
 * Запускается после `prisma db push` — в CI и в `npm run test:db:setup`.
 * На проде то же самое делают миграции, здесь дублирования нет: db push
 * миграции не применяет вовсе.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const sql = readFileSync(resolve(__dirname, 'raw-indexes.sql'), 'utf8')
  // Комментарии вырезаем: $executeRawUnsafe принимает по одному оператору.
  const statements = sql
    .split(/\n/)
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement)
  }
  console.log(`  Raw indexes applied: ${statements.length}`)
  await prisma.$disconnect()
}

main().catch(async error => {
  console.error(error)
  await prisma.$disconnect()
  process.exit(1)
})
