// Пределы цены на крафтовое сырьё (Дима 15.11): не дешевле затрат +20% и не
// дороже затрат +100%. Затраты = госцены входов рецепта на 1 штуку результата;
// рецептов несколько — берём самый дешёвый. Дима 16.11: «не на все мин и макс
// цена есть» — у добываемого сырья (без входов) затраты считаются по госцене.
import type { Prisma } from '@prisma/client'
import { BalanceConfig } from '../../config/balance.config'
import { prisma } from '../../shared/db/prisma'

type Db = Prisma.TransactionClient | typeof prisma

export interface PriceBounds { cost: number; min: number; max: number }

export async function craftPriceBounds(db: Db, resourceTemplateId: string): Promise<PriceBounds | null> {
  const resource = await db.resourceTemplate.findUnique({ where: { id: resourceTemplateId }, select: { code: true, basePrice: true } })
  if (!resource) return null
  const recipes = await db.productionRecipe.findMany({
    where: { outputResourceCode: resource.code, isActive: true },
    select: { outputAmount: true, inputs: { select: { resourceCode: true, amount: true } } },
  })
  const crafted = recipes.filter(recipe => recipe.inputs.length > 0 && recipe.outputAmount > 0)
  if (!crafted.length) return boundsFromCost(resource.basePrice)
  const codes = [...new Set(crafted.flatMap(recipe => recipe.inputs.map(input => input.resourceCode)))]
  const prices = new Map((await db.resourceTemplate.findMany({ where: { code: { in: codes } }, select: { code: true, basePrice: true } })).map(row => [row.code, row.basePrice]))
  const costs = crafted.map(recipe => recipe.inputs.reduce((sum, input) => sum + input.amount * (prices.get(input.resourceCode) ?? 0), 0) / recipe.outputAmount)
  return boundsFromCost(Math.min(...costs))
}

function boundsFromCost(cost: number): PriceBounds | null {
  if (!(cost > 0)) return null
  const M = BalanceConfig.economy.market as { craftPriceMin?: number; craftPriceMax?: number }
  const min = Math.ceil(cost * (M.craftPriceMin ?? 1.2))
  const max = Math.max(min, Math.floor(cost * (M.craftPriceMax ?? 2)))
  return { cost: Math.round(cost * 100) / 100, min, max }
}

/** Цена лота в рублях за штуку вне пределов → текст ошибки, иначе null. */
export function boundsError(name: string, bounds: PriceBounds, unitRub: number): string | null {
  if (unitRub >= bounds.min && unitRub <= bounds.max) return null
  return `Цена за штуку «${name}»: от ${bounds.min} до ${bounds.max} ₽`
}
