import{request}from'./client'
export type UpgradeType='DAMAGE'|'ACCURACY'|'CRIT'|'ARMOR'|'DURABILITY'|'ANTI_CRIT'
export interface UpgradeItem{id:string;upgradeLevel:number;template:{name:string;type:string}}
export interface UpgradePreview{itemId:string;upgradeType:UpgradeType;currentTotalLevel:number;nextTotalLevel:number;cost:number;chance:number;requiredResources:{resourceCode:string;resourceName:string;amount:number;available:number;enough:boolean}[];canCommit:boolean;effectiveStats:Record<string,number>}
export const upgradesApi={items:()=>request<UpgradeItem[]>('/api/upgrades/items'),preview:(itemInstanceId:string,upgradeType:UpgradeType)=>request<UpgradePreview>('/api/upgrades/preview',{method:'POST',body:{itemInstanceId,upgradeType}}),commit:(itemInstanceId:string,upgradeType:UpgradeType)=>request<{success:boolean;levelAfter:number;cost:number}>('/api/upgrades/commit',{method:'POST',body:{itemInstanceId,upgradeType},headers:{'Idempotency-Key':crypto.randomUUID()}})}

// Вставка камней: сорт камня даёт очки, огранка — куда они лягут.
export interface StoneGrade{code:string;name:string;points:number;fee:number}
export interface StoneCut{kind:UpgradeType;name:string}
export interface StoneRules{socketsPerItem:number;grades:StoneGrade[];cuts:StoneCut[]}
export interface SocketPreview{itemId:string;socketsUsed:number;socketsMax:number;price:number;gain:{kind:UpgradeType;points:number};enoughMoney:boolean;hasFreeSocket:boolean;canCommit:boolean;currentAllocation:Partial<Record<UpgradeType,number>>;effectiveStats:Record<string,number>}
export const socketsApi={
 rules:()=>request<StoneRules>('/api/upgrades/stones'),
 preview:(itemInstanceId:string,stoneCode:string,cutKind:UpgradeType)=>request<SocketPreview>('/api/upgrades/sockets/preview',{method:'POST',body:{itemInstanceId,stoneCode,cutKind}}),
 insert:(itemInstanceId:string,stoneCode:string,cutKind:UpgradeType)=>request<{itemId:string;socketsUsed:number;socketsMax:number;gain:{kind:UpgradeType;points:number};price:number}>('/api/upgrades/sockets/insert',{method:'POST',body:{itemInstanceId,stoneCode,cutKind},headers:{'Idempotency-Key':crypto.randomUUID()}}),
}
