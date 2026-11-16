import{describe,expect,it}from'vitest'
import{calcListingFee,calcMarketSellerEcoExp,calcSaleTax,calcSellerPayout,marketListingExpiresAt}from'../../modules/market/market.formulas'
describe('market formulas',()=>{
 // Дима 16.11: выставление бесплатно, с продажи 10%.
 it('выставление бесплатно',()=>{expect(calcListingFee(1)).toBe(0);expect(calcListingFee(1000)).toBe(0);expect(calcListingFee(1_000_000)).toBe(0)})
 it('налог с продажи 10%',()=>{expect(calcSaleTax(1000)).toBe(100);expect(calcSaleTax(99)).toBe(10)})
 it('seller payout subtracts tax',()=>expect(calcSellerPayout(1000)).toBe(900))
 it('экономический опыт продавца — 2% оборота',()=>expect(calcMarketSellerEcoExp(1000)).toBe(20))
 it('listing expires in 72 hours',()=>{const n=new Date('2026-08-03T00:00:00Z');expect(marketListingExpiresAt(n).getTime()-n.getTime()).toBe(72*3600_000)})
})
