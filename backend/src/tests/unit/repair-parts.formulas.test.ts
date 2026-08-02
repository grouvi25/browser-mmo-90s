import { describe, expect, it } from 'vitest'
import { calcRequiredRepairParts, needsRepairParts, repairPartsCode } from '../../modules/repair/repair.formulas'
describe('repair parts formulas',()=>{
 it('tier1 unupgraded needs no parts',()=>{expect(needsRepairParts(1,0)).toBe(false);expect(calcRequiredRepairParts(40,100,1,0)).toBe(0)})
 it('tier2 at 40% loss requires one part',()=>expect(calcRequiredRepairParts(40,100,2,0)).toBe(1))
 it('tier2 at 60% loss and upgrade 2 requires three parts',()=>expect(calcRequiredRepairParts(60,100,2,2)).toBe(3))
 it('upgraded tier1 needs parts',()=>{expect(needsRepairParts(1,1)).toBe(true);expect(calcRequiredRepairParts(50,100,1,1)).toBe(1)})
 it('caps loss ratio and returns seven at worst tier2 upgrade5',()=>expect(calcRequiredRepairParts(100,100,2,5)).toBe(7))
 it('uses template resource code or repair kit default',()=>{expect(repairPartsCode('comp_weapon_part')).toBe('comp_weapon_part');expect(repairPartsCode(null)).toBe('comp_repair_kit')})
})
