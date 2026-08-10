import{request}from'./client'
export interface MarketListingView{id:string;type:'ITEM'|'RESOURCE';status:string;itemInstanceId:string|null;resourceTemplateId:string|null;resourceAmount:number|null;price:number;listingFee:number;sellerCharacterId:string;sellerNickname:string;sellerUrl:string;expiresAt:string;item:{name:string;code:string;type:string;weaponType:string|null;levelReq:number;quality:string}|null}
export interface MarketFilters{mine?:boolean;type?:'ITEM'|'RESOURCE';combat?:'MELEE'|'RANGED';level?:number}
export const marketApi={
 list:(filters:MarketFilters={})=>{const q=new URLSearchParams();if(filters.mine)q.set('mine','true');if(filters.type)q.set('type',filters.type);if(filters.combat)q.set('combat',filters.combat);if(filters.level!==undefined)q.set('level',String(filters.level));return request<{items:MarketListingView[];total:number}>(`/api/market/listings?${q}`)},
 createItem:(itemInstanceId:string,price:number)=>request('/api/market/listings',{method:'POST',body:{listingType:'ITEM',itemInstanceId,price},headers:{'Idempotency-Key':crypto.randomUUID()}}),
 createResource:(resourceTemplateId:string,amount:number,price:number)=>request('/api/market/listings',{method:'POST',body:{listingType:'RESOURCE',resourceTemplateId,amount,price},headers:{'Idempotency-Key':crypto.randomUUID()}}),
 buy:(id:string)=>request(`/api/market/listings/${id}/buy`,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()}}),cancel:(id:string)=>request(`/api/market/listings/${id}/cancel`,{method:'POST'})}
