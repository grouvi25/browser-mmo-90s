import { BalanceConfig } from '../../config/balance.config'
import { prisma } from '../../shared/db/prisma'
import { assertRecipeOutputShape } from './recipe.formulas'
import { PROFESSION_NAMES, type ProfessionCode } from '../professions/professions'
import { govCraftable, realShiftMinutes } from '../work/work.formulas'

export const RecipeService = {
  /**
   * Справочник «как сделать» (заказчик 4.11: «чтобы людям понятно было, как и что делать»).
   * По каждому товару: где он получается, что для этого нужно и куда идёт дальше.
   * Собирается из действующих рецептов и объектов сам, новый рецепт виден сразу.
   */
  async catalog(characterId: string) {
    const [objects, recipes, professions, shop] = await Promise.all([
      prisma.productionObject.findMany({
        where: { isActive: true },
        select: { code: true, name: true, isForSale: true, shiftDurationMinutes: true, producesResourceCode: true, baseSalary: true, requiredProfessionCode: true, ownerType: true },
      }),
      prisma.productionRecipe.findMany({ where: { isActive: true }, include: { inputs: true } }),
      prisma.characterProfession.findMany({ where: { characterId }, select: { professionCode: true } }),
      prisma.governmentShopItem.findMany({ where: { isAvailable: true, template: { isActive: true } }, select: { template: { select: { code: true } } } }),
    ])
    const objectOf = new Map(objects.map(object => [object.code, object]))
    const live = recipes.filter(recipe => objectOf.has(recipe.productionObjectCode))
    const codes = new Set(live.flatMap(recipe => [
      recipe.outputResourceCode, recipe.outputItemTemplateCode, recipe.requiredToolCode, ...recipe.inputs.map(input => input.resourceCode),
    ].filter((code): code is string => !!code)))
    for (const object of objects) if (object.producesResourceCode) codes.add(object.producesResourceCode)
    const [resources, items] = await Promise.all([
      prisma.resourceTemplate.findMany({ where: { code: { in: [...codes] } }, select: { code: true, name: true } }),
      prisma.itemTemplate.findMany({ where: { code: { in: [...codes] } }, select: { code: true, name: true } }),
    ])
    const nameOf = new Map([...resources, ...items].map(row => [row.code, row.name]))
    const kindOf = new Set(items.map(row => row.code))
    const inShop = new Set(shop.map(row => row.template.code))
    const known = new Set(professions.map(row => row.professionCode))
    const professionName = (code: string | null) => (code ? PROFESSION_NAMES[code as ProfessionCode] ?? code : null)

    type Way = {
      objectCode: string; objectName: string; gather: boolean; forSaleUsd: number | null; shiftMinutes: number; labor: number
      /** Госцех: сколько идёт одно изделие на госработе. Там считается цикл рецепта, а не нормочасы своего завода (№104). */
      craftMinutes: number | null
      /** Рецепт точки добычи у государства: делается только на своём, купленном заводе. */
      ownedOnly: boolean
      professionCode: string | null; professionName: string | null; professionKnown: boolean
      toolCode: string | null; toolName: string | null; inputs: { code: string; name: string; amount: number }[]
    }
    const ways = new Map<string, Way[]>()
    const usedIn = new Map<string, Set<string>>()
    const add = (code: string, way: Way) => {
      const list = ways.get(code)
      if (list) { if (!list.some(row => row.objectCode === way.objectCode)) list.push(way) } else ways.set(code, [way])
    }
    // То же правило, что в вакансиях: цех книги не работает, пока его не купят. На старых объектах с окладом смены идут и так.
    const forSale = (object: { isForSale: boolean; baseSalary: number; producesResourceCode: string | null; ownerType: string }) =>
      object.ownerType === 'SYSTEM' && object.baseSalary === 0 && !object.producesResourceCode && object.isForSale ? BalanceConfig.economy.production.objectPriceUsd : null
    for (const recipe of live) {
      const output = recipe.outputResourceCode ?? recipe.outputItemTemplateCode
      if (!output) continue
      const object = objectOf.get(recipe.productionObjectCode)!
      add(output, {
        objectCode: object.code!, objectName: object.name, gather: recipe.inputs.length === 0, forSaleUsd: forSale(object),
        shiftMinutes: object.shiftDurationMinutes, labor: recipe.laborRequired,
        craftMinutes: govCraftable(object) && recipe.inputs.length > 0 ? realShiftMinutes(recipe.cycleMinutes) : null,
        ownedOnly: object.ownerType === 'SYSTEM' && !!object.producesResourceCode,
        professionCode: recipe.requiredProfessionCode, professionName: professionName(recipe.requiredProfessionCode), professionKnown: known.has(recipe.requiredProfessionCode),
        toolCode: recipe.requiredToolCode, toolName: recipe.requiredToolCode ? nameOf.get(recipe.requiredToolCode) ?? recipe.requiredToolCode : null,
        inputs: recipe.inputs.map(input => ({ code: input.resourceCode, name: nameOf.get(input.resourceCode) ?? input.resourceCode, amount: input.amount })),
      })
      for (const input of recipe.inputs) {
        const set = usedIn.get(input.resourceCode) ?? new Set<string>()
        set.add(output)
        usedIn.set(input.resourceCode, set)
      }
    }
    // Точки сбора без рецепта: ресурс задан прямо на объекте.
    for (const object of objects) {
      if (!object.producesResourceCode) continue
      add(object.producesResourceCode, {
        objectCode: object.code!, objectName: object.name, gather: true, forSaleUsd: forSale(object),
        shiftMinutes: object.shiftDurationMinutes, labor: object.shiftDurationMinutes,
        craftMinutes: null,
        ownedOnly: false,
        professionCode: object.requiredProfessionCode, professionName: professionName(object.requiredProfessionCode), professionKnown: !!object.requiredProfessionCode && known.has(object.requiredProfessionCode),
        toolCode: null, toolName: null, inputs: [],
      })
    }
    const products = [...ways.entries()].map(([code, list]) => ({
      code, name: nameOf.get(code) ?? code, kind: kindOf.has(code) ? 'item' as const : 'resource' as const, inShop: inShop.has(code),
      // Сначала то, что доступно сразу: добыча и госцех, в конце — только свой завод.
      ways: list.sort((a, b) => Number(b.gather) - Number(a.gather) || Number(a.ownedOnly) - Number(b.ownedOnly) || a.objectName.localeCompare(b.objectName, 'ru')),
      usedIn: [...(usedIn.get(code) ?? [])].map(next => ({ code: next, name: nameOf.get(next) ?? next })).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    }))
    return products.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  },

  async listForObject(objectCode: string, characterId: string) {
    const [recipes, professions] = await Promise.all([
      prisma.productionRecipe.findMany({
        where: { productionObjectCode: objectCode, isActive: true },
        include: { inputs: true },
      }),
      prisma.characterProfession.findMany({ where: { characterId } }),
    ])
    const levelOf = new Map(professions.map(item => [item.professionCode, item.level]))
    // Названия вместо кодов: в таблице рецептов игрок видел res_scrap_metal
    // и scrap_collector (правка заказчика 20.10).
    const resourceCodes = [...new Set(recipes.flatMap(recipe => [
      ...recipe.inputs.map(input => input.resourceCode),
      ...(recipe.outputResourceCode ? [recipe.outputResourceCode] : []),
    ]))]
    const itemCodes = [...new Set(recipes.flatMap(recipe => [recipe.outputItemTemplateCode, recipe.requiredToolCode].filter((code): code is string => !!code)))]
    const [resources, items] = await Promise.all([
      prisma.resourceTemplate.findMany({ where: { code: { in: resourceCodes } }, select: { code: true, name: true } }),
      prisma.itemTemplate.findMany({ where: { code: { in: itemCodes } }, select: { code: true, name: true } }),
    ])
    const nameOf = new Map([...resources, ...items].map(row => [row.code, row.name]))
    return recipes.map(recipe => {
      assertRecipeOutputShape(recipe)
      const ownLevel = levelOf.get(recipe.requiredProfessionCode) ?? 0
      const outputCode = recipe.outputResourceCode ?? recipe.outputItemTemplateCode
      return {
        ...recipe,
        inputs: recipe.inputs.map(input => ({ ...input, resourceName: nameOf.get(input.resourceCode) ?? input.resourceCode })),
        outputName: outputCode ? nameOf.get(outputCode) ?? outputCode : null,
        requiredProfessionName: PROFESSION_NAMES[recipe.requiredProfessionCode as ProfessionCode] ?? recipe.requiredProfessionCode,
        requiredToolName: recipe.requiredToolCode ? nameOf.get(recipe.requiredToolCode) ?? recipe.requiredToolCode : null,
        available: ownLevel >= recipe.requiredProfessionLevel,
        missingLevel: Math.max(0, recipe.requiredProfessionLevel - ownLevel),
      }
    })
  },
}
