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
for (const file of stage2) {
  const sql = readFileSync(file, 'utf8')
  for (const rule of forbidden) if (rule.test(sql)) failures.push(`${file}: ${rule}`)
}
if (stage2.length === 0) failures.push('No Stage 2 migrations found')
if (failures.length) {
  console.error('Stage 2 migrations are not additive:\n' + failures.join('\n'))
  process.exit(1)
}
console.log(`Migration additivity OK: ${stage2.length} Stage 2 migrations checked`)
