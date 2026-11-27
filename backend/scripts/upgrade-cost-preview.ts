/**
 * «Было / стало» по цене улучшения крафтовых вещей (обращение №195) — для Миши
 * до выката. Ничего не пишет в базу.
 *
 * Было: ресурсы рецепта вещи × номер улучшения, деньги от цены вещи.
 * Стало: одна формула от уровня вещи и номера улучшения (craftUpgradeCost).
 *
 *   npx tsx scripts/upgrade-cost-preview.ts --md > upgrade-cost.md
 */
import { PrismaClient } from '@prisma/client'
import { calcUpgradeCost, craftUpgradeCost } from '../src/modules/upgrades/upgrades.formulas'

async function main() {
  const prisma = new PrismaClient()
  try {
    const templates = await prisma.itemTemplate.findMany({
      where: { upgradeAllowed: true, isActive: true, type: { in: ['WEAPON', 'ARMOR', 'ACCESSORY', 'SHIELD'] }, sourceType: { notIn: ['DONATE', 'PREMIUM'] } },
      select: { code: true, name: true, levelReq: true, priceBase: true },
      orderBy: [{ levelReq: 'asc' }, { name: 'asc' }],
    })
    const recipes = await prisma.productionRecipe.findMany({
      where: { outputItemTemplateCode: { in: templates.map(t => t.code) }, isActive: true },
      select: { code: true, outputItemTemplateCode: true, inputs: { select: { resourceCode: true, amount: true } } },
      orderBy: { code: 'asc' },
    })
    const names = new Map((await prisma.resourceTemplate.findMany({ select: { code: true, name: true } })).map(r => [r.code, r.name]))
    const recipeOf = new Map<string, { resourceCode: string; amount: number }[]>()
    for (const r of recipes) if (!recipeOf.has(r.outputItemTemplateCode!)) recipeOf.set(r.outputItemTemplateCode!, r.inputs)
    const list = (rows: { code: string; amount: number }[]) => rows.map(r => `${r.amount} × ${names.get(r.code) ?? r.code}`).join(', ') || '—'
    const md = process.argv.includes('--md')
    if (md) console.log('| Вещь | Ур. | Улучш. | Было: ₽ | Было: ресурсы | Стало: ₽ | Стало: ресурсы |\n|---|---|---|---|---|---|---|')
    for (const t of templates) {
      const inputs = recipeOf.get(t.code)
      for (const n of [1, 3, 5]) {
        const before = inputs ? list(inputs.map(i => ({ code: i.resourceCode, amount: i.amount * n }))) : 'нет рецепта — не улучшалась'
        const after = craftUpgradeCost(t.levelReq, n)
        const row = [t.name, Math.max(1, t.levelReq), n, calcUpgradeCost(t.priceBase, n), before, after.money, list(after.resources)]
        console.log(md ? `| ${row.join(' | ')} |` : row.join('\t'))
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}

void main()
