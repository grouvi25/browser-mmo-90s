import{api}from'./client'
export interface SandboxInput{days:number;players:number;salary:number;battleReward:number;repairCost:number;marketPrice:number}
export interface SandboxResult{meta:{source:string;references:string[];generatedAt:string};input:SandboxInput;rows:Array<{profile:'fighter'|'worker'|'mixed';money:number;netPerDay:number;minted:number;burned:number;sinkShare:number}>;verdicts:{profileParity:boolean;sinkHealth:boolean;nonNegative:boolean};totals:{sinkShare:number;minted:number;burned:number}}
export const balanceSandboxApi={simulate:(input:SandboxInput)=>api.post<SandboxResult>('/api/balance-sandbox/simulate',input)}
