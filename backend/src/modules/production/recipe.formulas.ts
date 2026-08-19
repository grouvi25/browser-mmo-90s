import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'

export interface RecipeOutputShape {
  outputResourceCode: string | null
  outputItemTemplateCode: string | null
}

export function assertRecipeOutputShape(recipe: RecipeOutputShape): void {
  const hasResource = Boolean(recipe.outputResourceCode)
  const hasItem = Boolean(recipe.outputItemTemplateCode)
  if (hasResource === hasItem) {
    throw new AppError(
      ErrorCode.PROD_RECIPE_INVALID,
      'Рецепт должен выпускать ровно один вид результата',
      500,
    )
  }
}
