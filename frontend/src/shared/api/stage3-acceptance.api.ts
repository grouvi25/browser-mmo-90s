import { api } from './client'
export interface Stage3Acceptance{checkedAt:string;ready:boolean;metrics:{recipes:number;farmCrops:number;barOffers:number;privateObjects:number;clans:number;brokenObjects:number;stuckCycles:number;frozenClans:number};verdicts:Record<string,boolean>}
export const stage3AcceptanceApi={get:()=>api.get<Stage3Acceptance>('/api/stage3/acceptance')}
