import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../backend/prisma/migrations/', import.meta.url))
const stage2 = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name >= '20260803')
  .map((entry) => join(root, entry.name, 'migration.sql'))

const forbidden = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i,
  /\bRENAME\s+(?:TABLE|COLUMN)\b/i,
]
const failures = []
// Единственное разрешённое изменение типа: расширение VARCHAR. Оно данные не трогает и
// таблицу не переписывает. Оператор должен стоять сразу под строкой-пометкой.
const WIDEN = /--\s*additivity:\s*widen-varchar\s*\r?\n\s*ALTER\s+TABLE\s+"\w+"\s+ALTER\s+COLUMN\s+"\w+"\s+TYPE\s+VARCHAR\(\d+\)\s*;/gi
for (const file of stage2) {
  const sql = readFileSync(file, 'utf8').replace(WIDEN, '')
  for (const rule of forbidden) if (rule.test(sql)) failures.push(`${file}: ${rule}`)
}
if (stage2.length === 0) failures.push('No Stage 2 migrations found')
if (failures.length) {
  console.error('Stage 2 migrations are not additive:\n' + failures.join('\n'))
  process.exit(1)
}
console.log(`Migration additivity OK: ${stage2.length} Stage 2 migrations checked`)
