import { describe, expect, it } from 'vitest'
import { craftProfessionForItem, professionLevelFromExp } from '../../modules/professions/professions'

describe('independent professions', () => {
  it.each([[0,0],[499,0],[500,1],[1499,1],[1500,2],[3499,2],[3500,3],[7999,3],[8000,4],[15999,4],[16000,5],[29999,5],[30000,6],[999999,6]])('maps %i XP to level %i', (xp, level) => expect(professionLevelFromExp(xp)).toBe(level))
  it('maps item families to their craft profession', () => {
    expect(craftProfessionForItem('WEAPON')).toBe('gunsmith')
    expect(craftProfessionForItem('ARMOR')).toBe('cooperative_builder')
    expect(craftProfessionForItem('CONSUMABLE')).toBe('pharmacist')
  })
})
