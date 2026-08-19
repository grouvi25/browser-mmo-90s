import { api } from './client'

export type FarmBuilding = 'BARREL'|'CANOPY'|'CELLAR'|'DOG'
export interface FarmPlot { id:string;slot:number;cropCode:string|null;readyAt:string|null;withersAt:string|null;waterCount:number;state:'EMPTY'|'GROWING'|'READY'|'WITHERED';building?:{type:FarmBuilding}|null }
export interface Crop { code:string;name:string;minutes:number;yieldMin:number;yieldMax:number;seedPrice:number;requiredLevel:number;available:boolean }
export interface FarmState { plots:FarmPlot[];crops:Crop[];professionLevel:number;nextPlotPrice:number|null;buildings:Record<FarmBuilding,{name:string;price:number}>;cellarSaleBonus:number }
export const farmApi={
  get:()=>api.get<FarmState>('/api/farm'),
  buyPlot:()=>api.post('/api/farm/plots'),
  plant:(plotId:string,cropCode:string)=>api.post(`/api/farm/plots/${plotId}/plant`,{cropCode}),
  water:(plotId:string)=>api.post(`/api/farm/plots/${plotId}/water`),
  harvest:(plotId:string)=>api.post(`/api/farm/plots/${plotId}/harvest`),
  build:(plotId:string,type:FarmBuilding)=>api.post(`/api/farm/plots/${plotId}/building`,{type}),
}
