import { request } from './client'
export interface ProductionObjectView { id:string; code:string; name:string; requiredProductionLevel:number; shiftDurationMinutes:number; baseSalary:number; baseProductionExp:number; producesResourceCode:string|null; producesResourceName:string|null; outputAmountMin:number; outputAmountMax:number; locked:boolean }
export interface WorkShiftView { id:string; status:string; startedAt:string; endsAt:string; baseSalary:number; isReady:boolean; remainingSeconds:number; productionObject:{name:string;code:string} }
export const workApi={
 objects:()=>request<{items:ProductionObjectView[];daily:{shiftsUsedToday:number;shiftsLimit:number}}>('/api/work/objects'),
 current:()=>request<{shift:WorkShiftView|null;daily:{shiftsUsedToday:number;shiftsLimit:number}}>('/api/work/shifts/current'),
 start:(productionObjectId:string)=>request<{shift:WorkShiftView}>('/api/work/shifts/start',{method:'POST',body:{productionObjectId}}),
 claim:(shiftId:string)=>request<{salary:number;productionExpGain:number;resourceReward:{code:string;amount:number}|null}>(`/api/work/shifts/${shiftId}/claim`,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()}}),
 cancel:(shiftId:string)=>request<{cancelled:boolean}>(`/api/work/shifts/${shiftId}/cancel`,{method:'POST'}),
}
