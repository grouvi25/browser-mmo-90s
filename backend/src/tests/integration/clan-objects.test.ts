/**
 * Объекты бригады (правка заказчика 28.10: «нет возможности главе клана
 * управлять недвижкой — забирать ресурсы, пополнять деньги на объект»).
 * Управляет участник с правом «Объекты»; деньги ходят через общак, выпуск —
 * на склад бригады, а не в карман того, кто нажал.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OwnershipService } from '../../modules/production/ownership.service'
import { ProductionService } from '../../modules/production/production.service'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function fixture() {
  const clan = await testPrisma.clan.create({ data: { name: uid('br'), tag: uid('t').slice(0, 8), treasury: 10_000 } })
  const boss = await testPrisma.clanRole.create({ data: { clanId: clan.id, code: 'boss', name: 'Главарь', rank: 100, permissions: ['OBJECTS', 'TREASURY_SPEND'] } })
  const fighter = await testPrisma.clanRole.create({ data: { clanId: clan.id, code: 'fighter', name: 'Боец', rank: 40, permissions: ['STORAGE_PUT'] } })
  const member = async (roleId: string) => {
    const login = uid('m')
    const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
    const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money: 500 } })
    await testPrisma.clanMember.create({ data: { clanId: clan.id, characterId: character.id, roleId, status: 'ACTIVE' } })
    return character
  }
  const leader = await member(boss.id)
  const soldier = await member(fighter.id)
  const object = await testPrisma.productionObject.create({
    data: {
      code: uid('obj'), name: 'Пилорама бригады', type: 'WORKSHOP', requiredProfessionCode: 'scrap_collector',
      shiftDurationMinutes: 30, baseSalary: 100, baseProductionExp: 10, ownerType: 'CLAN', ownerClanId: clan.id,
      storageCapacity: 1000, inventory: { create: { resourceCode: 'res_wood', quality: 'NORMAL', amount: 7 } },
    },
  })
  return { clan, leader, soldier, object }
}

describe('объекты бригады', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  it('главарь пополняет из общака, выводит в общак и забирает выпуск на склад бригады', async () => {
    const { clan, leader, object } = await fixture()
    await testPrisma.resourceTemplate.upsert({ where: { code: 'res_wood' }, update: {}, create: { code: 'res_wood', name: 'Доски', category: 'PRIMARY', tier: 1, basePrice: 5, weight: 1 } })

    expect((await ProductionService.mine(leader.id)).map(row => row.id)).toContain(object.id)

    const topped = await OwnershipService.topUp(leader.id, object.id, 3000, uid('top'))
    expect(topped).toMatchObject({ balance: 3000, newCharacterBalance: null, treasury: 7000 })
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: leader.id } })).money).toBe(500)

    const out = await OwnershipService.withdraw(leader.id, object.id, 1000, uid('out'))
    expect(out).toMatchObject({ payout: 950, newBalance: null, treasury: 7950 })

    const took = await OwnershipService.stockTake(leader.id, object.id, 'res_wood', 7, uid('take'))
    expect(took).toMatchObject({ to: 'CLAN_STORAGE', ownAmount: 7 })
    const storage = await testPrisma.clanStorage.findUniqueOrThrow({ where: { clanId_resourceCode: { clanId: clan.id, resourceCode: 'res_wood' } } })
    expect(storage.amount).toBe(7)
    expect(await testPrisma.clanTreasuryLog.count({ where: { clanId: clan.id } })).toBe(2)
  })

  it('боец без права «Объекты» ничего не трогает, общак в минус не уходит', async () => {
    const { leader, soldier, object } = await fixture()
    expect((await ProductionService.mine(soldier.id)).map(row => row.id)).not.toContain(object.id)
    await expect(OwnershipService.topUp(soldier.id, object.id, 100, uid('top'))).rejects.toMatchObject({ code: 'PROD_008' })
    await expect(OwnershipService.withdraw(soldier.id, object.id, 100, uid('out'))).rejects.toMatchObject({ statusCode: 403 })
    await expect(OwnershipService.topUp(leader.id, object.id, 10_001, uid('top'))).rejects.toMatchObject({ statusCode: 409 })
  })
})
