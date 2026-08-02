import{request}from'./client'
export type UpgradeType='DAMAGE'|'ACCURACY'|'CRIT'|'ARMOR'|'DURABILITY'|'ANTI_CRIT'
export interface UpgradeItem{id:string;upgradeLevel:number;template:{name:string;type:string}}
export interface UpgradePreview{itemId:string;upgradeType:UpgradeType;currentTotalLevel:number;nextTotalLevel:number;cost:number;chance:number;requiredResources:{resourceCode:string;resourceName:string;amount:number;available:number;enough:boolean}[];canCommit:boolean;effectiveStats:Record<string,number>}
export const upgradesApi={items:()=>request<UpgradeItem[]>('/api/upgrades/items'),preview:(itemInstanceId:string,upgradeType:UpgradeType)=>request<UpgradePreview>('/api/upgrades/preview',{method:'POST',body:{itemInstanceId,upgradeType}}),commit:(itemInstanceId:string,upgradeType:UpgradeType)=>request<{success:boolean;levelAfter:number;cost:number}>('/api/upgrades/commit',{method:'POST',body:{itemInstanceId,upgradeType},headers:{'Idempotency-Key':crypto.randomUUID()}})}
