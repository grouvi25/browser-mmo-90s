import { describe, expect, it } from 'vitest'
import { craftProfessionForItem, professionLevelFromExp, previousProfession, PROFESSION_CHAINS } from '../../modules/professions/professions'
import { admissionRequirement } from '../../modules/work/work.formulas'
import { PRODUCTION_OBJECTS, OBJECT_PROFESSIONS } from '../../../prisma/economy-data'

describe('лестница переделов', () => {
  it('первый передел ни от чего не зависит', () => {
    expect(previousProfession('scrap_collector')).toBeNull()
    expect(previousProfession('supplier')).toBeNull()
    expect(previousProfession('procurer')).toBeNull()
  })

  it('второй и третий переделы смотрят на предыдущий в своём направлении', () => {
    expect(previousProfession('foundry_worker')).toBe('scrap_collector')
    expect(previousProfession('gunsmith')).toBe('foundry_worker')
    expect(previousProfession('carpenter')).toBe('supplier')
    expect(previousProfession('chemist')).toBe('pharmacist')
  })

  it('допуск никогда не требует ту же профессию, которую объект качает', () => {
    // Иначе объект заперт сам собой: опыт этой профессии больше нигде не дают.
    for (const object of PRODUCTION_OBJECTS) {
      const requirement = admissionRequirement({
        requiredProfessionCode: OBJECT_PROFESSIONS[object.code],
        requiredProfessionLevel: Math.min(object.requiredProductionLevel, 3),
      })
      if (requirement) expect(requirement.professionCode).not.toBe(OBJECT_PROFESSIONS[object.code])
    }
  })

  it('в каждом направлении есть объект без требований', () => {
    for (const chain of Object.values(PROFESSION_CHAINS)) {
      const entry = PRODUCTION_OBJECTS.find(object =>
        OBJECT_PROFESSIONS[object.code] === chain[0] && object.requiredProductionLevel === 0)
      expect(entry, `нет входного объекта для ${chain[0]}`).toBeTruthy()
    }
  })

  it('объект без требования уровня открыт всем', () => {
    expect(admissionRequirement({ requiredProfessionCode: 'foundry_worker', requiredProfessionLevel: 0 })).toBeNull()
  })
})

describe('independent professions', () => {
  it.each([[0,0],[499,0],[500,1],[1499,1],[1500,2],[3499,2],[3500,3],[7999,3],[8000,4],[15999,4],[16000,5],[29999,5],[30000,6],[999999,6]])('maps %i XP to level %i', (xp, level) => expect(professionLevelFromExp(xp)).toBe(level))
  it('maps item families to their craft profession', () => {
    expect(craftProfessionForItem('WEAPON')).toBe('gunsmith')
    expect(craftProfessionForItem('ARMOR')).toBe('cooperative_builder')
    expect(craftProfessionForItem('CONSUMABLE')).toBe('pharmacist')
  })
})
