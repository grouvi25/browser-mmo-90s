import { BalanceConfig } from '../../config/balance.config'
const UPGRADE_BALANCE=BalanceConfig.economy.upgrades
import { mergeAllocations } from '../items/item-stats.formulas'
import { socketAllocation } from './upgrades.stones'
export type UpgradeKind='DAMAGE'|'ACCURACY'|'CRIT'|'ARMOR'|'DURABILITY'|'ANTI_CRIT'
export function calcUpgradeCost(priceBase:number,nextTotalLevel:number,qualityCoeff=1):number{return Math.max(1,Math.round(priceBase*UPGRADE_BALANCE.costRate*Math.pow(nextTotalLevel,UPGRADE_BALANCE.costPower)*qualityCoeff))}
export function calcUpgradeSuccessChance(currentTotalLevel:number,productionLevel:number):number{return Math.min(UPGRADE_BALANCE.maxChance,Math.max(UPGRADE_BALANCE.minChance,UPGRADE_BALANCE.baseChance-currentTotalLevel*UPGRADE_BALANCE.chanceLossPerLevel+productionLevel*UPGRADE_BALANCE.professionBonusPerLevel))}
export function requiredUpgradeResource(itemType:string,nextTotalLevel:number){if(itemType==='WEAPON')return{code:'comp_weapon_part',amount:nextTotalLevel};if(itemType==='ARMOR')return{code:'comp_armor_plate',amount:nextTotalLevel};throw new Error('Unsupported item type')}
// Улучшения прочности больше не ставятся (правка 28.10, у всех вещей прочность 100).
export function isUpgradeCompatible(itemType:string,type:UpgradeKind):boolean{return itemType==='WEAPON'?['DAMAGE','ACCURACY','CRIT'].includes(type):itemType==='ARMOR'?['ARMOR','ANTI_CRIT'].includes(type):false}
/** Правка 31.10: очко всегда прибавляет хотя бы единицу. У брони 3 процент терялся на округлении (3 × 1,06 = 3), у урона 0 был нулём: «добавляю статы, а ничего не добавляется». */
function withPoints(base:number,rate:number,points:number):number{return base+Math.max(points,Math.round(base*rate*points))}
export function applyUpgradeModifiers(base:{minDamage?:number|null;maxDamage?:number|null;weaponAccuracy?:number|null;critBonus?:number|null;armor?:number|null;durabilityMax:number;antiCrit?:number|null;statAllocation?:unknown},mods:Partial<Record<UpgradeKind,number>>,instanceAllocation?:unknown,sockets?:unknown){const all=mergeAllocations(base.statAllocation,instanceAllocation,mods,socketAllocation(sockets));return{minDamage:withPoints(base.minDamage??0,.04,all.DAMAGE??0),maxDamage:withPoints(base.maxDamage??0,.04,all.DAMAGE??0),weaponAccuracy:(base.weaponAccuracy??0)+.01*(all.ACCURACY??0),critBonus:(base.critBonus??0)+.005*(all.CRIT??0),armor:withPoints(base.armor??0,.06,all.ARMOR??0),durabilityMax:Math.round(base.durabilityMax*(1+.08*(all.DURABILITY??0))),antiCrit:(base.antiCrit??0)+.005*(all.ANTI_CRIT??0)}}
