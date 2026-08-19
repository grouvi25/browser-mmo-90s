import { api } from './client'
export interface BarOffer{id:string;name:string;price:number;baseCost:number;hpRestore:number;alcoholDegrees:number;accuracyBuff:number;damageBuff:number;buffMinutes:number}
export interface Bar{ id:string;name:string;ownerCharacterId:string|null;balance:number;barOffers:BarOffer[] }
export interface IntoxicationStatus{level:number;state:'SOBER'|'TIPSY'|'DRUNK'|'WASTED';accuracy:number;incomingDamage:number;outgoingDamage:number;canBattle:boolean;soberAt:string|null;hangoverUntil:string|null;buff:{accuracy:number;damage:number;expiresAt:string}|null}
export const barsApi={list:()=>api.get<{items:Bar[]}>('/api/bars'),status:()=>api.get<IntoxicationStatus>('/api/bars/status'),buy:(id:string)=>api.post(`/api/bars/offers/${id}/buy`,undefined,{headers:{'Idempotency-Key':crypto.randomUUID()}}),setPrice:(id:string,price:number)=>api.patch(`/api/bars/offers/${id}/price`,{price})}
