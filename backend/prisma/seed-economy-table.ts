/**
 * Сид экономики заказчика (economy-table.ts). Отдельным файлом, чтобы тест
 * прогонял ровно то же, что и выкат.
 *
 * Шаблоны вещей только создаются: статы и эффекты заказчик вносит в админке,
 * и следующий выкат не должен их стирать. Владельцев объектов сид не трогает.
 */
import type { PrismaClient } from '@prisma/client'
import { TABLE_ITEMS, TABLE_OBJECTS, TABLE_RECIPES, TABLE_RESOURCES, TABLE_TOOLS, tablePrice } from './economy-table'

export async function seedEconomyTable(prisma: PrismaClient) {
  for (const [code, name, tier, units] of TABLE_RESOURCES) {
    const data = { name, tier, basePrice: tablePrice(units), category: tier === 1 ? 'PRIMARY' as const : 'COMPONENT' as const, isActive: true }
    await prisma.resourceTemplate.upsert({ where: { code }, update: data, create: { code, weight: 0.3, ...data } })
  }

  // Завод инструментов сначала надо купить, поэтому первый набор продаёт государство.
  for (const [code, name, units, uses] of TABLE_TOOLS) {
    const saved = await prisma.itemTemplate.upsert({
      where: { code },
      update: { usesMax: uses, priceBase: tablePrice(units) },
      create: { code, name, type: 'TOOL', toolTier: 1, usesMax: uses, weight: 1, durabilityMax: 1, priceBase: tablePrice(units), sourceType: 'GOVERNMENT', isEquippable: false },
    })
    await prisma.governmentShopItem.upsert({ where: { templateId: saved.id }, update: {}, create: { templateId: saved.id } })
  }

  for (const item of TABLE_ITEMS) {
    const worn = item.group === 'clothes'
    await prisma.itemTemplate.upsert({
      where: { code: item.code },
      update: {},
      create: {
        code: item.code, name: item.name, type: worn ? 'ARMOR' : 'CONSUMABLE', armorSlot: worn ? item.slot as 'CHEST' : null,
        isEquippable: worn, armor: 0, itemTier: item.tier, priceBase: tablePrice(item.units), sourceType: 'CRAFTED',
      },
    })
  }

  for (const object of TABLE_OBJECTS) {
    const data = {
      name: object.name, type: object.type, requiredProfessionCode: object.profession, shiftDurationMinutes: object.shiftMinutes,
      producesResourceCode: object.resource, outputAmountMin: object.gather ? 1 : 0, outputAmountMax: object.gather ? 1 : 0,
      baseProductionExp: object.gather ? 10 : 20, locationId: object.district, storageCapacity: 1000,
    }
    // Оклада нет: заработок в книге — сама продукция, а цехи работают на владельца.
    await prisma.productionObject.upsert({
      where: { code: object.code },
      update: data,
      create: { code: object.code, baseSalary: 0, isForSale: !object.gather, purchasePrice: object.gather ? null : 15_000, ownerType: 'SYSTEM', ...data },
    })
  }

  for (const recipe of TABLE_RECIPES) {
    // Время книги — это труд. Таймер цикла идёт уже после него, иначе срок считался бы дважды.
    const data = {
      name: recipe.name, productionObjectCode: recipe.object, outputResourceCode: recipe.resource, outputItemTemplateCode: recipe.item,
      outputAmount: 1, cycleMinutes: 1, laborRequired: recipe.minutes, requiredProfessionCode: recipe.profession, requiredToolCode: recipe.tool,
    }
    const saved = await prisma.productionRecipe.upsert({ where: { code: recipe.code }, update: data, create: { code: recipe.code, ...data } })
    await prisma.productionRecipeInput.deleteMany({ where: { recipeId: saved.id } })
    await prisma.productionRecipeInput.createMany({ data: recipe.inputs.map(([resourceCode, amount]) => ({ recipeId: saved.id, resourceCode, amount })) })
    await prisma.productionObject.updateMany({ where: { code: recipe.object, activeRecipeId: null }, data: { activeRecipeId: saved.id } })
  }
  console.log(`  Экономика заказчика: ресурсов ${TABLE_RESOURCES.length}, объектов ${TABLE_OBJECTS.length}, рецептов ${TABLE_RECIPES.length}`)
}
