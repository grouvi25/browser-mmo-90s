import { prisma } from '../../shared/db/prisma'
import { assertRecipeOutputShape } from './recipe.formulas'

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
    return recipes.map(recipe => {
      assertRecipeOutputShape(recipe)
      const ownLevel = levelOf.get(recipe.requiredProfessionCode) ?? 0
      return {
        ...recipe,
        available: ownLevel >= recipe.requiredProfessionLevel,
        missingLevel: Math.max(0, recipe.requiredProfessionLevel - ownLevel),
      }
    })
  },
}
