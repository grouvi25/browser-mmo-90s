import { BalanceConfig } from '../../config/balance.config'
const B=BalanceConfig.economy.market
export function calcListingFee(price:number):number{return Math.max(B.listingFeeMin,Math.round(price*B.listingFeeRate))}
export function calcSaleTax(price:number):number{return Math.round(price*B.saleTaxRate)}
export function calcSellerPayout(price:number):number{return price-calcSaleTax(price)}
export function calcMarketSellerEcoExp(price:number):number{return Math.round(price*B.sellerEcoExpRate)}
export function marketListingExpiresAt(now=new Date()):Date{return new Date(now.getTime()+B.listingDurationHours*60*60*1000)}
