import { BalanceConfig } from '../../config/balance.config'
const B=BalanceConfig.economy.market
export function calcListingFee(price:number):number{return Math.max(B.listingFeeMin,Math.round(price*B.listingFeeRate))}
export function calcSaleTax(price:number):number{return Math.round(price*B.saleTaxRate)}
export function calcSellerPayout(price:number):number{return price-calcSaleTax(price)}
/** Экономический опыт продавца — 2% оборота, как у любой продажи (книга «Ревизия 2»). */
export function calcMarketSellerEcoExp(price:number):number{return Math.floor(price*BalanceConfig.economicExp.turnoverRate)}
export function marketListingExpiresAt(now=new Date()):Date{return new Date(now.getTime()+B.listingDurationHours*60*60*1000)}
