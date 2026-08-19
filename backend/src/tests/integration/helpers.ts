/**
 * Integration test helpers — shared DB client and cleanup utilities.
 * Used by all integration tests.
 */
import { PrismaClient } from '@prisma/client'

export const testPrisma = new PrismaClient({
  log: [],
  errorFormat: 'minimal',
})

/** Clean test data in correct order (respecting FK constraints) */
export async function cleanDatabase(): Promise<void> {
  await testPrisma.$transaction([
    testPrisma.idempotencyKey.deleteMany(),
    testPrisma.resourceLog.deleteMany(),
    testPrisma.farmBuilding.deleteMany(),
    testPrisma.farmPlot.deleteMany(),
    testPrisma.productionLog.deleteMany(),
    testPrisma.cycleInputReservation.deleteMany(),
    testPrisma.cycleLaborContribution.deleteMany(),
    testPrisma.productionCycle.deleteMany(),
    testPrisma.productionObjectInventory.deleteMany(),
    testPrisma.productionRecipeInput.deleteMany(),
    testPrisma.productionRecipe.deleteMany(),
    testPrisma.upgradeLog.deleteMany(),
    testPrisma.marketListing.deleteMany(),
    testPrisma.privateShopItem.deleteMany(),
    testPrisma.workShift.deleteMany(),
    testPrisma.characterProfession.deleteMany(),
    testPrisma.resourceStack.deleteMany(),
    testPrisma.productionObject.deleteMany(),
    testPrisma.resourceTemplate.deleteMany(),
    testPrisma.battleTurn.deleteMany(),
    testPrisma.battleParticipant.deleteMany(),
    testPrisma.battle.deleteMany(),
    testPrisma.repairLog.deleteMany(),
    testPrisma.itemLog.deleteMany(),
    testPrisma.currencyLog.deleteMany(),
    testPrisma.weaponSkill.deleteMany(),
    testPrisma.itemInstance.deleteMany(),
    testPrisma.governmentShopItem.deleteMany(),
    testPrisma.characterStats.deleteMany(),
    testPrisma.character.deleteMany(),
    testPrisma.session.deleteMany(),
    testPrisma.user.deleteMany(),
  ])
}

/** Generate unique test identifiers */
let counter = 0
export function uid(prefix = 'test'): string {
  return `${prefix}_${Date.now()}_${++counter}_${Math.random().toString(36).slice(2, 6)}`
}
