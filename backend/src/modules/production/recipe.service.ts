import { prisma } from '../../shared/db/prisma'
import { assertRecipeOutputShape } from './recipe.formulas'
import { PROFESSION_NAMES, type ProfessionCode } from '../professions/professions'

export const RecipeService = {
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
    const itemCodes = [...new Set(recipes.flatMap(recipe => recipe.outputItemTemplateCode ? [recipe.outputItemTemplateCode] : []))]
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
        available: ownLevel >= recipe.requiredProfessionLevel,
        missingLevel: Math.max(0, recipe.requiredProfessionLevel - ownLevel),
      }
    })
  },
}
