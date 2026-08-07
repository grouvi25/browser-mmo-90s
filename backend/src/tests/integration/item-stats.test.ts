import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ItemStatsService } from '../../modules/items/item-stats.service'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function fixture() {
  const login = uid('stats')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80 } })
  const template = await testPrisma.itemTemplate.create({ data: { code: uid('weapon'), name: 'Player weapon', type: 'WEAPON', weaponType: 'PISTOL', minDamage: 10, maxDamage: 20, weight: 1, durabilityMax: 100, priceBase: 100, sourceType: 'PRIVATE', allocationMode: 'PLAYER', statBudget: 3 } })
  const item = await testPrisma.itemInstance.create({ data: { templateId: template.id, ownerId: character.id, durabilityCurrent: 100, durabilityMax: 100, weight: 1, sourceType: 'PRIVATE', freePoints: 3 } })
  return { character, item }
}

describe('ItemStatsService TZ 2.2', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(cleanDatabase)
  afterAll(async () => testPrisma.$disconnect())
  it('allocates compatible points once and audits the change', async () => {
    const { character, item } = await fixture()
    const result = await ItemStatsService.allocate(character.id, item.id, 'DAMAGE', 2)
    expect(result).toMatchObject({ freePoints: 1, statAllocation: { DAMAGE: 2 } })
    expect(await testPrisma.itemLog.count({ where: { itemId: item.id, actionCode: 'POINTS_ALLOCATED' } })).toBe(1)
    await expect(ItemStatsService.allocate(character.id, item.id, 'ARMOR', 1)).rejects.toMatchObject({ statusCode: 422 })
    await expect(ItemStatsService.allocate(character.id, item.id, 'DAMAGE', 2)).rejects.toMatchObject({ statusCode: 409 })
  })
})
