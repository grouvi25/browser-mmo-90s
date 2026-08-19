export interface Stage3AcceptanceInput {
  recipes: number
  farmCrops: number
  barOffers: number
  privateObjects: number
  clans: number
  brokenObjects: number
  stuckCycles: number
  frozenClans: number
}

export function stage3Verdicts(input: Stage3AcceptanceInput) {
  return {
    recipesReady: input.recipes >= 15,
    farmReady: input.farmCrops >= 5,
    barsReady: input.barOffers >= 7,
    ownershipLive: input.privateObjects >= 0,
    clansLive: input.clans >= 0,
    noBrokenObjects: input.brokenObjects === 0,
    noStuckCycles: input.stuckCycles === 0,
  }
}
