import { describe, expect, it } from 'vitest'
import { BalanceConfig } from '../../config/balance.config'
import { calcFinalSalary, calcProductionExp, dailyShiftSalaryCoeff, getProductionLevelFromExp, objectLevelCoeff, workerEfficiency } from '../../modules/work/work.formulas'
describe('work formulas',()=>{
 it('maps legacy aggregate through exact TZ 2.2 profession thresholds',()=>{expect(getProductionLevelFromExp(0)).toBe(0);expect(getProductionLevelFromExp(499)).toBe(0);expect(getProductionLevelFromExp(500)).toBe(1);expect(getProductionLevelFromExp(16000)).toBe(5);expect(getProductionLevelFromExp(30000)).toBe(6);expect(getProductionLevelFromExp(999999)).toBe(6)})
 it('uses 3% efficiency per PL',()=>{expect(workerEfficiency(0)).toBe(1);expect(workerEfficiency(3)).toBeCloseTo(1.09)})
 it('uses 25% coefficient per object level',()=>{expect(objectLevelCoeff(1)).toBe(1);expect(objectLevelCoeff(3)).toBe(1.5)})
 it('keeps the first shift full and applies bounded fatigue through shift eight',()=>{expect(dailyShiftSalaryCoeff(1)).toBe(1);expect(dailyShiftSalaryCoeff(4)).toBeCloseTo(.4);expect(dailyShiftSalaryCoeff(8)).toBeCloseTo(.2);expect(dailyShiftSalaryCoeff(99)).toBeCloseTo(.2)})
 it('calculates deterministic salary, applies fatigue and clamps to x3',()=>{expect(calcFinalSalary(100,1,0,0.5,1)).toBe(100);expect(calcFinalSalary(100,1,0,0.5,8)).toBe(20);expect(calcFinalSalary(100,99,10,1,1)).toBe(300)})
 it('calculates production exp from object level',()=>{expect(calcProductionExp(10,1)).toBe(10);expect(calcProductionExp(10,3)).toBe(15)})
  it('keeps production seed tool prices synchronized with the Stage 2 contract', () => {
    expect(BalanceConfig.economy.tools.tiers).toEqual({ 1: { price: 500, uses: 50 }, 2: { price: 1250, uses: 50 }, 3: { price: 1800, uses: 50 } })
  })
})
