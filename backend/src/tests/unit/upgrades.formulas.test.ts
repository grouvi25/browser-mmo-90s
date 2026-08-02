import{describe,expect,it}from'vitest'
import{applyUpgradeModifiers,calcUpgradeCost,calcUpgradeSuccessChance,isUpgradeCompatible,requiredUpgradeResource}from'../../modules/upgrades/upgrades.formulas'
describe('upgrade formulas',()=>{
 it('cost follows price x 0.15 x level^1.4',()=>{expect(calcUpgradeCost(2400,1)).toBe(360);expect(calcUpgradeCost(2400,5)/calcUpgradeCost(2400,1)).toBeCloseTo(Math.pow(5,1.4),1)})
 it('chance falls per level, rises with PL and clamps',()=>{expect(calcUpgradeSuccessChance(0,0)).toBe(.9);expect(calcUpgradeSuccessChance(4,0)).toBeCloseTo(.42);expect(calcUpgradeSuccessChance(4,10)).toBeCloseTo(.52);expect(calcUpgradeSuccessChance(-20,0)).toBe(.95);expect(calcUpgradeSuccessChance(20,0)).toBe(.15)})
 it('requires weapon or armor parts equal to next level',()=>{expect(requiredUpgradeResource('WEAPON',3)).toEqual({code:'comp_weapon_part',amount:3});expect(requiredUpgradeResource('ARMOR',2)).toEqual({code:'comp_armor_plate',amount:2})})
 it('validates compatible upgrade types',()=>{expect(isUpgradeCompatible('WEAPON','DAMAGE')).toBe(true);expect(isUpgradeCompatible('WEAPON','ARMOR')).toBe(false);expect(isUpgradeCompatible('ARMOR','ANTI_CRIT')).toBe(true)})
 it('applies modifiers from base template values',()=>{const x=applyUpgradeModifiers({minDamage:45,maxDamage:90,weaponAccuracy:.78,critBonus:0,armor:34,durabilityMax:100,antiCrit:.07},{DAMAGE:5,ACCURACY:2,CRIT:1,ARMOR:5,DURABILITY:2,ANTI_CRIT:2});expect(x.minDamage).toBe(54);expect(x.maxDamage).toBe(108);expect(x.weaponAccuracy).toBeCloseTo(.8);expect(x.critBonus).toBeCloseTo(.005);expect(x.armor).toBe(44);expect(x.durabilityMax).toBe(116);expect(x.antiCrit).toBeCloseTo(.08)})
})
