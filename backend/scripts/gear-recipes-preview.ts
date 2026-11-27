/**
 * Предпросмотр рецептов шмота по схеме (обращение №190) — для Миши до выката.
 * Ничего не пишет в базу: читает вещи и рецепты и печатает, что создаст сид.
 *
 *   npx tsx scripts/gear-recipes-preview.ts            # таблица
 *   npx tsx scripts/gear-recipes-preview.ts --md > gear.md
 */
import { PrismaClient } from '@prisma/client'
import { planGearRecipes } from '../prisma/seed-economy-table'
import { GEAR_KIND_TITLE, TABLE_RESOURCES } from '../prisma/economy-table'

async function main() {
  const prisma = new PrismaClient()
  try {
    const plan = await planGearRecipes(prisma)
    const names = new Map(TABLE_RESOURCES.map(([code, name]) => [code, name]))
    const objects = new Map((await prisma.productionObject.findMany({ select: { code: true, name: true } })).map(o => [o.code, o.name]))
    const md = process.argv.includes('--md')
    if (md) console.log('| Вид | Ур. | Вещь | Цех | Труд, мин | Детали |\n|---|---|---|---|---|---|')
    for (const r of plan) {
      const inputs = r.inputs.map(([code, n]) => `${n} × ${names.get(code) ?? code}`).join(', ')
      const row = [GEAR_KIND_TITLE[r.kind], r.level, r.name, objects.get(r.object) ?? r.object, r.minutes, inputs]
      console.log(md ? `| ${row.join(' | ')} |` : row.join('\t'))
    }
    console.error(`\nВсего рецептов по схеме: ${plan.length}`)
  } finally {
    await prisma.$disconnect()
  }
}

void main()
