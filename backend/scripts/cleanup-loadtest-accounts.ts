import { statSync } from 'fs'
import { prisma } from '../src/shared/db/prisma'

const dryRun = process.env.CONFIRM_CLEANUP !== 'yes'
const from = new Date('2026-07-20T00:00:00Z')
const to = new Date('2026-07-22T00:00:00Z')
const patterns = ['loadtest_', 'ZP2_', 'MvProd', 'ZoneProd', 'TZ_', 'ProdProf']
const where = {
  registeredAt: { gte: from, lt: to },
  OR: [
    ...patterns.map(login => ({ login: { startsWith: login } })),
    { email: { endsWith: '@loadtest.local' } },
    ...patterns.map(nickname => ({ character: { nickname: { startsWith: nickname } } })),
  ],
}
function assertBackup() {
  const path = process.env.BACKUP_FILE
  if (!path) throw new Error('BACKUP_FILE is required')
  const ageHours = (Date.now() - statSync(path).mtimeMs) / 3_600_000
  if (ageHours > 24) throw new Error(`Backup is stale: ${ageHours.toFixed(1)}h`)
}
async function main() {
  const matches = await prisma.user.findMany({ where, select: { id: true, login: true, email: true, registeredAt: true }, take: 5000 })
  console.table(matches.slice(0, 20).map(({ id: _id, ...row }) => row))
  console.log(`Matched load-test users: ${matches.length}`)
  if (dryRun) { console.log('Dry-run only. Use CONFIRM_CLEANUP=yes with BACKUP_FILE to apply.'); return }
  assertBackup()
  const ids = matches.map(x => x.id)
  if (!ids.length) return
  const result = await prisma.user.deleteMany({ where: { id: { in: ids } } })
  console.log(`Deleted users: ${result.count}`)
}
main().finally(() => prisma.$disconnect())
