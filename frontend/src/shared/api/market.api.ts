import{request}from'./client'
export interface MarketListingView{id:string;type:'ITEM'|'RESOURCE';status:string;itemInstanceId:string|null;resourceTemplateId:string|null;resourceAmount:number|null;price:number;listingFee:number;sellerCharacterId:string;sellerNickname:string;sellerUrl:string;expiresAt:string}
export const marketApi={
 list:(mine=false,type?:'ITEM'|'RESOURCE')=>request<{items:MarketListingView[];total:number}>(`/api/market/listings?mine=${mine}${type?`&type=${type}`:''}`),
 createItem:(itemInstanceId:string,price:number)=>request('/api/market/listings',{method:'POST',body:{listingType:'ITEM',itemInstanceId,price},headers:{'Idempotency-Key':crypto.randomUUID()}}),
 createResource:(resourceTemplateId:string,amount:number,price:number)=>request('/api/market/listings',{method:'POST',body:{listingType:'RESOURCE',resourceTemplateId,amount,price},headers:{'Idempotency-Key':crypto.randomUUID()}}),
 buy:(id:string)=>request(`/api/market/listings/${id}/buy`,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()}}),
 cancel:(id:string)=>request(`/api/market/listings/${id}/cancel`,{method:'POST'}),
}
