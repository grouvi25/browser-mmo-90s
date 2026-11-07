import { request } from './client'
import type { ItemTemplate } from '../types/api.types'
export interface PrivateShopItemView{id:string;shopCode:string;price:number;stockMode:string;stockAmount:number|null;minBattleLevel:number;minEconomicLevel:number;minProductionLevel:number;kind:'ITEM'|'RESOURCE';name:string;code:string;itemTier:number;levelReq:number;template:ItemTemplate|null}
export const privateShopsApi={
 shops:()=>request<{code:string;name:string}[]>('/api/private-shops'),
 items:(code:string)=>request<PrivateShopItemView[]>(`/api/private-shops/${code}/items`),
 buy:(shopCode:string,privateShopItemId:string,quantity=1)=>request<{total:number;newBalance:number}>(`/api/private-shops/${shopCode}/buy`,{method:'POST',body:{privateShopItemId,quantity},headers:{'Idempotency-Key':crypto.randomUUID()}}),
}
