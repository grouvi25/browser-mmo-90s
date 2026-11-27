/**
 * Сид экономики заказчика (economy-table.ts). Отдельным файлом, чтобы тест
 * прогонял ровно то же, что и выкат.
 *
 * Шаблоны вещей только создаются: статы и эффекты заказчик вносит в админке,
 * и следующий выкат не должен их стирать. Броню из таблицы получают только вещи,
 * которые ещё никто не правил. Владельцев объектов сид не трогает.
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { TABLE_ITEM_EFFECTS, TABLE_ITEMS, TABLE_OBJECTS, TABLE_RECIPES, TABLE_RESOURCES, TABLE_TOOLS, gearRecipePlan, tablePrice, type GearRecipePlan } from './economy-table'

const RENAMED_ITEMS: readonly (readonly [string, string, string])[] = [
  ['tb_item_a05', 'Аптечка полевая', 'Аптечка походная'],
  ['tb_item_a07', 'Настойка скорости', 'Настойка ловкости'],
  ['tb_item_a08', 'Противоядие', 'Отрезвитель'],
  ['tb_item_w06', 'Свиток скорости', 'Свиток ловкости'],
  // Юрист 18.11: перо стало печатной машинкой.
  ['tool_tb_u08', 'Рунное перо', 'Печатная машинка'],
]
// Юрист 18.11: свитки нотариальной конторы заменены договором подряда.
// Рецепты гасятся, а не удаляются: по ним остались циклы и журналы. Свитки у игроков остаются.
const RETIRED_RECIPES = ['rcp_tb_w01', 'rcp_tb_w02', 'rcp_tb_w03', 'rcp_tb_w04', 'rcp_tb_w05', 'rcp_tb_w06']

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
        code: item.code, name: item.name, description: item.description ?? null, type: worn ? 'ARMOR' : 'CONSUMABLE', armorSlot: worn ? item.slot as 'CHEST' : null,
        isEquippable: worn, healPercent: item.healPercent ?? 0, soberAmount: item.soberAmount ?? 0, armor: item.armor ?? 0, levelReq: item.level ?? 0, durabilityMax: item.durability ?? 100, itemTier: item.tier, priceBase: tablePrice(item.units), sourceType: 'CRAFTED',
      },
    })
    // Описание — только пустое: текст, поправленный в админке, выкат не стирает.
    if (item.description) {
      await prisma.itemTemplate.updateMany({ where: { code: item.code, OR: [{ description: null }, { description: '' }] }, data: { description: item.description } })
    }
    // Шаблон уже есть, поэтому лечение ставим отдельно и только там, где его ещё не правили.
    if (item.soberAmount) {
      await prisma.itemTemplate.updateMany({ where: { code: item.code, soberAmount: 0 }, data: { soberAmount: item.soberAmount } })
    }
    if (item.healPercent) {
      await prisma.itemTemplate.updateMany({ where: { code: item.code, healPercent: 0 }, data: { healPercent: item.healPercent } })
    }
    const useEffect = TABLE_ITEM_EFFECTS[item.code]
    if (useEffect) {
      await prisma.itemTemplate.updateMany({ where: { code: item.code, useEffect: { equals: Prisma.DbNull } }, data: { useEffect } })
    }
    if (worn) {
      await prisma.itemTemplate.updateMany({
        where: { code: item.code, armor: 0, levelReq: 0 },
        data: { armor: item.armor ?? 0, levelReq: item.level ?? 0, durabilityMax: item.durability ?? 100 },
      })
    }
  }

  // Названия из предложений к таблице: вещь, переименованную в админке, не трогаем.
  for (const [code, from, to] of RENAMED_ITEMS) {
    await prisma.itemTemplate.updateMany({ where: { code, name: from }, data: { name: to } })
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

  await prisma.productionRecipe.updateMany({ where: { code: { in: RETIRED_RECIPES } }, data: { isActive: false } })
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
  // Рецепт уехал в другой завод, а у государственного объекта остался активным: ставим его первый свой.
  for (const object of TABLE_OBJECTS) {
    const first = TABLE_RECIPES.find(recipe => recipe.object === object.code)
    if (!first) continue
    const own = await prisma.productionRecipe.findUnique({ where: { code: first.code }, select: { id: true } })
    const current = await prisma.productionObject.findUnique({ where: { code: object.code }, select: { ownerType: true, activeRecipeId: true } })
    if (!own || current?.ownerType !== 'SYSTEM' || !current.activeRecipeId) continue
    const active = await prisma.productionRecipe.findUnique({ where: { id: current.activeRecipeId }, select: { productionObjectCode: true } })
    if (active?.productionObjectCode !== object.code) await prisma.productionObject.update({ where: { code: object.code }, data: { activeRecipeId: own.id } })
  }

  // Объект, у которого активным остался снятый рецепт, получает первый живой свой.
  const retired = await prisma.productionRecipe.findMany({ where: { code: { in: RETIRED_RECIPES } }, select: { id: true, productionObjectCode: true } })
  for (const recipe of retired) {
    const live = TABLE_RECIPES.find(row => row.object === recipe.productionObjectCode)
    const liveId = live ? (await prisma.productionRecipe.findUnique({ where: { code: live.code }, select: { id: true } }))?.id : undefined
    await prisma.productionObject.updateMany({ where: { activeRecipeId: recipe.id }, data: { activeRecipeId: liveId ?? null } })
  }

  // Цехи первой версии вошли в заводы таблицы v2. Купленный цех остаётся у владельца.
  await prisma.productionObject.updateMany({
    where: { code: { startsWith: 'obj_tb_', notIn: TABLE_OBJECTS.map(object => object.code) }, ownerType: 'SYSTEM' },
    data: { isActive: false, isForSale: false },
  })
  const gear = await seedGearRecipes(prisma)
  console.log(`  Экономика заказчика: ресурсов ${TABLE_RESOURCES.length}, объектов ${TABLE_OBJECTS.length}, рецептов ${TABLE_RECIPES.length}, рецептов шмота по схеме ${gear.length}`)
}

/**
 * План рецептов шмота 1–5 уровня по схеме (обращение №190): вещи из базы, у
 * которых нет ни одного рецепта. Сгенерированные раньше (rcp_gear_*) в план
 * попадают снова — так правка схемы доезжает до них при следующем выкате.
 */
export async function planGearRecipes(prisma: PrismaClient): Promise<GearRecipePlan[]> {
  const [templates, recipes] = await Promise.all([
    prisma.itemTemplate.findMany({
      where: { type: { in: ['WEAPON', 'ARMOR', 'ACCESSORY'] } },
      select: { code: true, name: true, type: true, weaponType: true, armorSlot: true, levelReq: true, sourceType: true, isActive: true },
    }),
    prisma.productionRecipe.findMany({ where: { outputItemTemplateCode: { not: null } }, select: { code: true, outputItemTemplateCode: true } }),
  ])
  const withRecipe = new Set(recipes.filter(r => !r.code.startsWith('rcp_gear_')).map(r => r.outputItemTemplateCode as string))
  return gearRecipePlan(templates, withRecipe)
}

async function seedGearRecipes(prisma: PrismaClient): Promise<GearRecipePlan[]> {
  const plan = await planGearRecipes(prisma)
  for (const recipe of plan) {
    const data = {
      name: recipe.name, productionObjectCode: recipe.object, outputResourceCode: null, outputItemTemplateCode: recipe.item,
      outputAmount: 1, cycleMinutes: 1, laborRequired: recipe.minutes, requiredProfessionCode: recipe.profession, requiredToolCode: recipe.tool,
      isActive: true,
    }
    const saved = await prisma.productionRecipe.upsert({ where: { code: recipe.code }, update: data, create: { code: recipe.code, ...data } })
    await prisma.productionRecipeInput.deleteMany({ where: { recipeId: saved.id } })
    await prisma.productionRecipeInput.createMany({ data: recipe.inputs.map(([resourceCode, amount]) => ({ recipeId: saved.id, resourceCode, amount })) })
  }
  return plan
}
