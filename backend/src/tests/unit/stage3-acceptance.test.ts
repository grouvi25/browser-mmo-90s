import { describe, expect, it } from 'vitest'
import { stage3Verdicts } from '../../modules/stage3-acceptance/stage3-acceptance.formulas'

describe('stage 3 acceptance', () => {
  it('requires recipes, five crops, seven offers and no broken invariants', () => {
    expect(stage3Verdicts({ recipes:15,farmCrops:5,barOffers:7,privateObjects:0,clans:0,brokenObjects:0,stuckCycles:0,frozenClans:0 })).toEqual({ recipesReady:true,farmReady:true,barsReady:true,ownershipLive:true,clansLive:true,noBrokenObjects:true,noStuckCycles:true })
  })
  it('fails incomplete or stuck systems', () => {
    const result=stage3Verdicts({ recipes:14,farmCrops:4,barOffers:6,privateObjects:0,clans:0,brokenObjects:1,stuckCycles:1,frozenClans:0 })
    expect(Object.values(result).filter(Boolean)).toHaveLength(2)
  })
})
