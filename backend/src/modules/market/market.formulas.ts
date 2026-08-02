export function calcListingFee(price:number):number{return Math.max(5,Math.round(price*0.02))}
export function calcSaleTax(price:number):number{return Math.round(price*0.05)}
export function calcSellerPayout(price:number):number{return price-calcSaleTax(price)}
export function calcMarketSellerEcoExp(price:number):number{return Math.round(price*0.03)}
export function marketListingExpiresAt(now=new Date()):Date{return new Date(now.getTime()+72*60*60*1000)}
