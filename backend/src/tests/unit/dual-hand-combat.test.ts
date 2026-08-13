import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttackerSnapshot, DefenderSnapshot } from '../../modules/battles/battle.formulas'
const attack = (damage:number):AttackerSnapshot => ({str:1,acc:100,agi:1,rea:1,luck:0,agr:0,end:1,weaponSkillLevel:1,minDamage:damage,maxDamage:damage,weaponAccuracy:1,critBonus:0,critDamageBonus:0,blockPierce:0,flatDamageBonus:0,equipmentWeight:0,antiDodgeBonus:0,antiCounterBonus:0})
const defender:DefenderSnapshot={agi:0,rea:0,end:1,luck:0,armor:0,dodgeBonus:0,antiCrit:1,blockBonus:0,armorWeight:0,antiSkillLevel:0,antiCounterDefense:0,antiLuck:1,minDamage:1,maxDamage:1}
afterEach(()=>vi.restoreAllMocks())
describe('dual-hand strike resolver',()=>{
  it('uses the selected hand weapon for each body-zone hit',async()=>{
    process.env.JWT_SECRET ??= 'unit_test_secret_32_chars_minimum_here'
    process.env.DATABASE_URL ??= 'postgresql://x:x@localhost:5432/x'
    process.env.REDIS_URL ??= 'redis://localhost:6379'
    const { executeStrikes } = await import('../../modules/battles/battles.service')
    vi.spyOn(Math,'random').mockReturnValue(.5)
    const result=executeStrikes({attackerSnap:attack(10),attackerSnaps:{LEFT_HAND:attack(10),RIGHT_HAND:attack(80)},weaponIds:{LEFT_HAND:'left-weapon',RIGHT_HAND:'right-weapon'},defenderSnap:defender,zoneArmorFor:()=>0,attackZones:['CHEST','CHEST'],attackHands:['LEFT_HAND','RIGHT_HAND'],blockedZones:[],defenderHp:500})
    expect(result.results.map(hit=>[hit.sourceHand,hit.weaponId])).toEqual([['LEFT_HAND','left-weapon'],['RIGHT_HAND','right-weapon']])
    expect(result.results[1].rawDamage).toBeGreaterThan(result.results[0].rawDamage)
  })
})
