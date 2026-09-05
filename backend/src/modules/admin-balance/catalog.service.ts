// =============================================================
// СПРАВОЧНИК ИГРЫ
//
// Вкладка «Предметы» показывала 22 шаблона вещей — и всё. При этом игра
// состоит ещё из тридцати ресурсов, тридцати восьми рецептов, пяти
// культур на огороде, четырнадцати объектов, госскупки и бара. Полтора
// десятка процентов содержимого на экране, остальное — только в базе.
//
// Но список ресурсов сам по себе тоже мало что даёт. Вопрос, который
// задают, глядя на ресурс, всегда один: ОТКУДА он берётся и КУДА
// девается. Если ресурс некуда деть — он мусор, если его негде взять —
// рецепт на нём мёртв. Поэтому здесь считаются цепочки: у каждого
// ресурса перечислены источники и потребители по имени.
//
// Всё читается из базы и из формул огорода, ничего не продублировано:
// разойтись с игрой справочник не может.
// =============================================================
import { prisma } from '../../shared/db/prisma'
import { CROPS, FARM_BUILDINGS, FARM_MAX_PLOTS, plotPrice } from '../farm/farm.formulas'

/** Ссылка в цепочке: человеку нужно имя, а не код. */
export interface ChainLink {
  kind: 'recipe' | 'crop' | 'object' | 'bar' | 'repair' | 'upgrade' | 'shop'
  title: string
  detail: string
}

export interface CatalogResource {
  code: string
  name: string
  category: string
  tier: number
  basePrice: number
  weight: number
  isTradable: boolean
  isActive: boolean
  /** Сколько всего лежит на руках у игроков — по этому числу видно,
   *  живой ресурс или мёртвый. */
  held: number
  sources: ChainLink[]
  uses: ChainLink[]
}

export interface CatalogRecipe {
  code: string
  name: string
  objectCode: string
  objectName: string
  output: { kind: 'resource' | 'item'; code: string; name: string; amount: number }
  inputs: { code: string; name: string; amount: number; minQuality: string }[]
  cycleMinutes: number
  laborRequired: number
  professionCode: string
  professionLevel: number
  toolTier: number
  isActive: boolean
  /** Выручка за цикл минус сырьё. Отрицательная маржа означает, что
   *  рецепт выгоднее не запускать вовсе. */
  marginPerCycle: number | null
  /** По какой цене считали выход: базовой или барной. Без этого четыре
   *  напитка выглядели убыточными — их просто никто не продаёт по
   *  базовой цене ресурса, они уходят через стойку. */
  priceBasis: 'base' | 'bar' | null
}

export async function buildCatalog() {
  const [resources, recipes, objects, items, shop, bar, bots, stacks] = await Promise.all([
    prisma.resourceTemplate.findMany({ orderBy: [{ category: 'asc' }, { tier: 'asc' }, { name: 'asc' }] }),
    prisma.productionRecipe.findMany({ include: { inputs: true }, orderBy: { name: 'asc' } }),
    prisma.productionObject.findMany({
      select: {
        code: true, name: true, type: true, status: true, level: true, workerSlots: true,
        shiftDurationMinutes: true, baseSalary: true, producesResourceCode: true,
        outputAmountMin: true, outputAmountMax: true, requiredProfessionCode: true,
        requiredProfessionLevel: true, storageCapacity: true, isActive: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.itemTemplate.findMany({ select: { code: true, name: true } }),
    prisma.governmentShopItem.findMany({
      select: { isAvailable: true, overridePrice: true, template: { select: { code: true, name: true, type: true, priceBase: true } } },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.barOffer.findMany({ orderBy: { name: 'asc' } }),
    prisma.bot.findMany({
      select: {
        code: true, name: true, battleLevel: true, power: true, hpMax: true,
        expReward: true, moneyRewardMin: true, moneyRewardMax: true, isActive: true,
      },
      orderBy: { battleLevel: 'asc' },
    }),
    prisma.resourceStack.groupBy({ by: ['resourceTemplateId'], _sum: { amount: true } }),
  ])

  const resourceName = new Map(resources.map(row => [row.code, row.name]))
  const resourcePrice = new Map(resources.map(row => [row.code, row.basePrice]))
  const itemName = new Map(items.map(row => [row.code, row.name]))
  const objectName = new Map(objects.map(row => [row.code, row.name]))
  const heldById = new Map(stacks.map(row => [row.resourceTemplateId, row._sum.amount ?? 0]))
  const name = (code: string) => resourceName.get(code) ?? itemName.get(code) ?? code

  // ── Цепочки ──────────────────────────────────────────────────
  const sources = new Map<string, ChainLink[]>()
  const uses = new Map<string, ChainLink[]>()
  const push = (map: Map<string, ChainLink[]>, code: string, link: ChainLink) => {
    const list = map.get(code)
    if (list) list.push(link)
    else map.set(code, [link])
  }

  for (const recipe of recipes) {
    const where = objectName.get(recipe.productionObjectCode) ?? recipe.productionObjectCode
    if (recipe.outputResourceCode) {
      push(sources, recipe.outputResourceCode, {
        kind: 'recipe',
        title: recipe.name,
        detail: `${where}, ${recipe.outputAmount} шт. за ${recipe.cycleMinutes} мин`,
      })
    }
    for (const input of recipe.inputs) {
      push(uses, input.resourceCode, {
        kind: 'recipe',
        title: recipe.name,
        detail: `${where}, ${input.amount} шт. на цикл`,
      })
    }
  }

  // Объект может выдавать ресурс сменой, вообще без рецепта — это
  // отдельный источник, и без него сырьё выглядит взявшимся ниоткуда.
  for (const object of objects) {
    if (!object.producesResourceCode) continue
    push(sources, object.producesResourceCode, {
      kind: 'object',
      title: object.name,
      detail: `смена ${object.shiftDurationMinutes} мин, ${object.outputAmountMin}–${object.outputAmountMax} шт.`,
    })
  }

  for (const [code, crop] of Object.entries(CROPS)) {
    push(sources, crop.resourceCode, {
      kind: 'crop',
      title: crop.name,
      detail: `огород, ${crop.yieldMin}–${crop.yieldMax} шт. за ${crop.minutes} мин, семена ${crop.seedPrice} ₽`,
    })
    void code
  }

  for (const offer of bar) {
    push(uses, offer.resourceCode, {
      kind: 'bar',
      title: offer.name,
      detail: `бар, ${offer.price} ₽ за порцию`,
    })
  }

  for (const resource of resources) {
    if (resource.isRepairMaterial) {
      push(uses, resource.code, { kind: 'repair', title: 'Ремонт вещей', detail: 'расходуется при починке' })
    }
    if (resource.isUpgradeMaterial) {
      push(uses, resource.code, { kind: 'upgrade', title: 'Улучшение вещей', detail: 'расходуется при апгрейде' })
    }
  }

  const catalogResources: CatalogResource[] = resources.map(row => ({
    code: row.code,
    name: row.name,
    category: row.category,
    tier: row.tier,
    basePrice: row.basePrice,
    weight: row.weight,
    isTradable: row.isTradable,
    isActive: row.isActive,
    held: heldById.get(row.id) ?? 0,
    sources: sources.get(row.code) ?? [],
    uses: uses.get(row.code) ?? [],
  }))

  // Напиток продаётся через стойку по цене бара, а не по базовой цене
  // ресурса, и по базовой четыре рецепта выглядели убыточными на пустом
  // месте. Берём ту цену, по которой выход реально уходит.
  const barPrice = new Map(bar.map(offer => [offer.resourceCode, offer.price]))

  const catalogRecipes: CatalogRecipe[] = recipes.map(recipe => {
    const outputCode = recipe.outputResourceCode ?? recipe.outputItemTemplateCode ?? ''
    const viaBar = recipe.outputResourceCode ? barPrice.get(recipe.outputResourceCode) : undefined
    const outputPrice = recipe.outputResourceCode
      ? viaBar ?? resourcePrice.get(recipe.outputResourceCode)
      : null
    const inputsCost = recipe.inputs.reduce(
      (sum, input) => sum + (resourcePrice.get(input.resourceCode) ?? 0) * input.amount, 0,
    )
    return {
      code: recipe.code,
      name: recipe.name,
      objectCode: recipe.productionObjectCode,
      objectName: objectName.get(recipe.productionObjectCode) ?? recipe.productionObjectCode,
      output: {
        kind: recipe.outputResourceCode ? 'resource' : 'item',
        code: outputCode,
        name: name(outputCode),
        amount: recipe.outputAmount,
      },
      inputs: recipe.inputs.map(input => ({
        code: input.resourceCode,
        name: name(input.resourceCode),
        amount: input.amount,
        minQuality: input.minQuality,
      })),
      cycleMinutes: recipe.cycleMinutes,
      laborRequired: recipe.laborRequired,
      professionCode: recipe.requiredProfessionCode,
      professionLevel: recipe.requiredProfessionLevel,
      toolTier: recipe.requiredToolTier,
      isActive: recipe.isActive,
      // Считаем только по ресурсам: у рецептов с выходом-вещью цена вещи
      // живёт в шаблоне и сравнивать её с сырьём напрямую нечестно.
      marginPerCycle: outputPrice === null || outputPrice === undefined
        ? null
        : outputPrice * recipe.outputAmount - inputsCost,
      priceBasis: outputPrice === null || outputPrice === undefined
        ? null
        : viaBar === undefined ? 'base' : 'bar',
    }
  })

  const crops = Object.entries(CROPS).map(([code, crop]) => {
    const price = resourcePrice.get(crop.resourceCode) ?? 0
    const averageYield = (crop.yieldMin + crop.yieldMax) / 2
    return {
      code,
      name: crop.name,
      minutes: crop.minutes,
      yieldMin: crop.yieldMin,
      yieldMax: crop.yieldMax,
      seedPrice: crop.seedPrice,
      resourceCode: crop.resourceCode,
      resourceName: resourceName.get(crop.resourceCode) ?? crop.resourceCode,
      resourcePrice: price,
      requiredLevel: crop.requiredLevel,
      // Ради этого числа на огород и смотрят: окупается ли грядка. Ноль
      // и минус означают, что культуру сажать незачем ни при каких ценах.
      profitPerCycle: Math.round(averageYield * price - crop.seedPrice),
      profitPerHour: Math.round((averageYield * price - crop.seedPrice) * 60 / crop.minutes),
    }
  })

  return {
    resources: catalogResources,
    recipes: catalogRecipes,
    crops,
    farm: {
      maxPlots: FARM_MAX_PLOTS,
      plotPrices: Array.from({ length: FARM_MAX_PLOTS }, (_, index) => plotPrice(index + 1)),
      buildings: Object.entries(FARM_BUILDINGS).map(([code, building]) => ({
        code, name: building.name, price: building.price,
      })),
    },
    objects,
    shop: shop.map(row => ({
      code: row.template.code,
      name: row.template.name,
      type: row.template.type,
      price: row.overridePrice ?? row.template.priceBase,
      isOverridden: row.overridePrice !== null,
      isAvailable: row.isAvailable,
    })),
    bar: bar.map(offer => ({
      code: offer.code,
      name: offer.name,
      resourceCode: offer.resourceCode,
      resourceName: resourceName.get(offer.resourceCode) ?? offer.resourceCode,
      price: offer.price,
      baseCost: offer.baseCost,
      hpRestore: offer.hpRestore,
      alcoholDegrees: offer.alcoholDegrees,
      accuracyBuff: offer.accuracyBuff,
      damageBuff: offer.damageBuff,
      buffMinutes: offer.buffMinutes,
      isActive: offer.isActive,
    })),
    bots,
  }
}
