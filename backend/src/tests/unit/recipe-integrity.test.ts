import { describe, expect, it } from 'vitest'
import { assertRecipeOutputShape } from '../../modules/production/recipe.formulas'

describe('recipe integrity', () => {
  it('accepts exactly one output kind', () => {
    expect(() => assertRecipeOutputShape({ outputResourceCode: 'res_scrap_metal', outputItemTemplateCode: null })).not.toThrow()
    expect(() => assertRecipeOutputShape({ outputResourceCode: null, outputItemTemplateCode: 'weapon_tt_private' })).not.toThrow()
  })

  it('rejects empty and double outputs', () => {
    expect(() => assertRecipeOutputShape({ outputResourceCode: null, outputItemTemplateCode: null })).toThrow()
    expect(() => assertRecipeOutputShape({ outputResourceCode: 'res_scrap_metal', outputItemTemplateCode: 'weapon_tt_private' })).toThrow()
  })
})
