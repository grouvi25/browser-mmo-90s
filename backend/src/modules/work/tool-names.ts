// Какой инструмент назвать игроку, когда смене нужен инструмент уровня N.
// Берём из того, что реально лежит в госмагазине: «Нужен T2» игроку ни о чём
// не говорит, он покупает не то (Glorious, 05.11: молот и клещи для Столяра).
import type { Prisma, PrismaClient } from '@prisma/client'

export type SoldTool = { name: string; tier: number; price: number }

/** Инструменты общего назначения из госмагазина, дешёвые первыми. */
export async function soldGeneralTools(db: Prisma.TransactionClient | PrismaClient): Promise<SoldTool[]> {
  const [rows, named] = await Promise.all([
    db.governmentShopItem.findMany({
      where: { isAvailable: true, template: { type: 'TOOL', isActive: true } },
      include: { template: { select: { code: true, name: true, toolTier: true, priceBase: true } } },
    }),
    // Инструмент под свои рецепты (молот и клещи, садовый набор) советовать на
    // любую работу незачем, хотя по уровню он и подходит.
    db.productionRecipe.findMany({ where: { requiredToolCode: { not: null } }, select: { requiredToolCode: true }, distinct: ['requiredToolCode'] }),
  ])
  const namedCodes = new Set(named.map(row => row.requiredToolCode))
  return rows
    .filter(row => !namedCodes.has(row.template.code))
    .map(row => ({ name: row.template.name, tier: row.template.toolTier ?? 0, price: row.overridePrice ?? row.template.priceBase }))
    .sort((a, b) => a.price - b.price)
}

/** Самый дешёвый инструмент, которым можно работать на оборудовании этого уровня. */
export function toolForTier(tools: readonly SoldTool[], tier: number): string | null {
  return tools.find(tool => tool.tier >= tier)?.name ?? null
}
