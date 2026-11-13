// №98 и Дима 13.11: пружину и сталь делает Токарь в своём госцехе, а не в Малом заводе,
// который настроен точкой добычи металлопластин и рецептов не показывает.
import { describe, expect, it } from 'vitest'
import { OBJECT_PROFESSIONS, PRODUCTION_OBJECTS, PRODUCTION_RECIPES } from '../../../prisma/economy-data'
import { PROFESSION_CODES, PROFESSION_NAMES } from '../../modules/professions/professions'
import { awaitsOwner } from '../../modules/work/work.formulas'

describe('Токарь', () => {
  it('профессия есть и продаётся вместе с остальными', () => {
    expect(PROFESSION_CODES).toContain('turner')
    expect(PROFESSION_NAMES.turner).toBe('Токарь')
  })

  it('Токарный цех работает как госцех: без оклада и добычи, на продаже', () => {
    const lathe = PRODUCTION_OBJECTS.find(o => o.code === 'obj_lathe')!
    expect(lathe).toBeTruthy()
    expect(OBJECT_PROFESSIONS.obj_lathe).toBe('turner')
    expect(awaitsOwner({ ownerType: 'SYSTEM', baseSalary: lathe.baseSalary, producesResourceCode: lathe.producesResourceCode, isForSale: true })).toBe(true)
  })

  it('пружина и кованая сталь делаются там с нулевого уровня', () => {
    for (const code of ['rcp_spring', 'rcp_prem_steel']) {
      const recipe = PRODUCTION_RECIPES.find(r => r.code === code)!
      expect(recipe).toMatchObject({ productionObjectCode: 'obj_lathe', requiredProfessionCode: 'turner', requiredProfessionLevel: 0 })
    }
  })
})
