import{describe,expect,it}from'vitest'
import{calcListingFee,calcMarketSellerEcoExp,calcSaleTax,calcSellerPayout,marketListingExpiresAt}from'../../modules/market/market.formulas'
describe('market formulas',()=>{
 it('listing fee is max 5 or rounded 2%',()=>{expect(calcListingFee(1)).toBe(5);expect(calcListingFee(100)).toBe(5);expect(calcListingFee(1000)).toBe(20);expect(calcListingFee(1_000_000)).toBe(20_000)})
 it('sale tax is rounded 5%',()=>{expect(calcSaleTax(1000)).toBe(50);expect(calcSaleTax(99)).toBe(5)})
 it('seller payout subtracts tax',()=>expect(calcSellerPayout(1000)).toBe(950))
 it('seller eco exp is rounded 3%',()=>expect(calcMarketSellerEcoExp(1000)).toBe(30))
 it('listing expires in 72 hours',()=>{const n=new Date('2026-08-03T00:00:00Z');expect(marketListingExpiresAt(n).getTime()-n.getTime()).toBe(72*3600_000)})
})
