import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { getRedis, disconnectRedis } from '../../shared/db/redis'
import { UpgradesService } from '../../modules/upgrades/upgrades.service'

async function registerAndCreateCharacter(app: FastifyInstance, money = 10_000) {
  const login = uid('race_user')
  const password = 'race_pass_123'
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { login, email: `${login}@test.local`, password },
  })
  expect(registered.statusCode).toBe(201)

  const logged = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { login, password },
  })
  expect(logged.statusCode).toBe(200)
  const token = logged.json<{ token: string; userId: string }>().token

  const created = await app.inject({
    method: 'POST',
    url: '/api/characters',
    headers: { authorization: `Bearer ${token}` },
    payload: { nickname: uid('RaceChar'), archetype: 'WORKER' },
  })
  expect(created.statusCode).toBe(201)
  const character = created.json<{ id: string }>()
  await testPrisma.character.update({ where: { id: character.id }, data: { money } })
  return { token, characterId: character.id }
}

async function damagedTier2Item(characterId: string) {
  const repairPart = await testPrisma.resourceTemplate.create({
    data: {
      code: 'comp_repair_kit',
      name: 'Repair kit',
      category: 'REPAIR_PART',
      tier: 2,
      basePrice: 50,
      weight: 0.5,
      isRepairMaterial: true,
    },
  })
  await testPrisma.resourceStack.create({
    data: { characterId, resourceTemplateId: repairPart.id, amount: 10 },
  })
  const template = await testPrisma.itemTemplate.create({
    data: {
      code: uid('repair_race_item'),
      name: 'Damaged armor',
      type: 'ARMOR',
      armorSlot: 'CHEST',
      armor: 15,
      weight: 2,
      durabilityMax: 100,
      priceBase: 1000,
      itemTier: 2,
      sourceType: 'PRIVATE',
      repairResourceCode: repairPart.code,
      upgradeAllowed: true,
    },
  })
  const item = await testPrisma.itemInstance.create({
    data: {
      templateId: template.id,
      ownerId: characterId,
      quality: 'COMMON',
      durabilityCurrent: 40,
      durabilityMax: 100,
      weight: 2,
      sourceType: 'PRIVATE',
    },
  })
  return { item, repairPart }
}

async function upgradeFixture() {
  const login = uid('upgrade_race')
  const user = await testPrisma.user.create({
    data: { login, email: `${login}@test.local`, passwordHash: 'x' },
  })
  const character = await testPrisma.character.create({
    data: {
      userId: user.id,
      nickname: login,
      archetype: 'WORKER',
      hpCurrent: 80,
      hpMax: 80,
      money: 10_000,
      productionLevel: 0,
    },
  })
  const part = await testPrisma.resourceTemplate.create({
    data: {
      code: 'comp_weapon_part',
      name: 'Weapon part',
      category: 'UPGRADE_PART',
      tier: 2,
      basePrice: 60,
      weight: 0.5,
      isUpgradeMaterial: true,
    },
  })
  await testPrisma.resourceStack.create({
    data: { characterId: character.id, resourceTemplateId: part.id, amount: 20 },
  })
  const template = await testPrisma.itemTemplate.create({
    data: {
      code: uid('upgrade_race_item'),
      name: 'Race pistol',
      type: 'WEAPON',
      weaponType: 'PISTOL',
      minDamage: 45,
      maxDamage: 90,
      weaponAccuracy: 0.78,
      weight: 1,
      durabilityMax: 100,
      priceBase: 2400,
      itemTier: 2,
      sourceType: 'PRIVATE',
      upgradeAllowed: true,
    },
  })
  const item = await testPrisma.itemInstance.create({
    data: {
      templateId: template.id,
      ownerId: character.id,
      quality: 'COMMON',
      durabilityCurrent: 100,
      durabilityMax: 100,
      weight: 1,
      sourceType: 'PRIVATE',
    },
  })
  return { character, item, part }
}

describe('Stage 2 repair and upgrade races', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    await testPrisma.$connect()
    await getRedis().ping()
    app = await buildApp()
    await app.ready()
  })

  beforeEach(async () => {
    await cleanDatabase()
    await getRedis().flushdb()
  })

  afterAll(async () => {
    await app.close()
    await testPrisma.$disconnect()
    await disconnectRedis()
  })

  it('repairs once when two commits race and charges money and parts once', async () => {
    const account = await registerAndCreateCharacter(app)
    const { item, repairPart } = await damagedTier2Item(account.characterId)
    const request = () => app.inject({
      method: 'POST',
      url: '/api/repair/commit',
      headers: { authorization: `Bearer ${account.token}` },
      payload: { itemInstanceId: item.id },
    })

    const responses = await Promise.all([request(), request()])
    expect(responses.filter(response => response.statusCode === 200)).toHaveLength(1)
    expect(responses.filter(response => response.statusCode === 400)).toHaveLength(1)

    const repaired = await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: item.id } })
    const owner = await testPrisma.character.findUniqueOrThrow({ where: { id: account.characterId } })
    const stack = await testPrisma.resourceStack.findUniqueOrThrow({
      where: {
        characterId_resourceTemplateId: {
          characterId: account.characterId,
          resourceTemplateId: repairPart.id,
        },
      },
    })
    expect(repaired.durabilityCurrent).toBe(100)
    expect(owner.money).toBeLessThan(10_000)
    expect(stack.amount).toBe(8)
    expect(await testPrisma.repairLog.count({ where: { itemId: item.id } })).toBe(1)
    expect(await testPrisma.currencyLog.count({ where: { refId: item.id, reasonCode: 'REPAIR_COST' } })).toBe(1)
    expect(await testPrisma.resourceLog.count({ where: { refId: item.id, reasonCode: 'REPAIR_USE' } })).toBe(1)
  })

  it('serializes two upgrades without lost levels or duplicated accounting', async () => {
    const { character, item, part } = await upgradeFixture()
    const results = await Promise.all([
      UpgradesService.commit(character.id, item.id, 'DAMAGE', 'upgrade-race-key-one', () => 0),
      UpgradesService.commit(character.id, item.id, 'DAMAGE', 'upgrade-race-key-two', () => 0),
    ])

    expect(results.every(result => result.success)).toBe(true)
    const upgraded = await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: item.id } })
    const owner = await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })
    const stack = await testPrisma.resourceStack.findUniqueOrThrow({
      where: {
        characterId_resourceTemplateId: {
          characterId: character.id,
          resourceTemplateId: part.id,
        },
      },
    })
    expect(upgraded.upgradeLevel).toBe(2)
    expect(upgraded.upgradeModifiersJson).toEqual({ DAMAGE: 2 })
    expect(owner.money).toBe(10_000 - 360 - 950)
    expect(stack.amount).toBe(17)
    expect(await testPrisma.upgradeLog.count({ where: { itemInstanceId: item.id } })).toBe(2)
    expect(await testPrisma.currencyLog.count({ where: { refId: item.id, reasonCode: 'UPGRADE_COST' } })).toBe(2)
    expect(await testPrisma.resourceLog.count({ where: { refId: item.id, reasonCode: 'UPGRADE_USE' } })).toBe(2)
  })

  it('replays concurrent duplicate upgrade requests and charges only once', async () => {
    const { character, item, part } = await upgradeFixture()
    const results = await Promise.all(
      Array.from({ length: 10 }, () => UpgradesService.commit(
        character.id,
        item.id,
        'DAMAGE',
        'upgrade-race-same-key',
        () => 0,
      )),
    )

    expect(results.every(result => result.levelAfter === 1)).toBe(true)
    const upgraded = await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: item.id } })
    const owner = await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })
    const stack = await testPrisma.resourceStack.findUniqueOrThrow({
      where: {
        characterId_resourceTemplateId: {
          characterId: character.id,
          resourceTemplateId: part.id,
        },
      },
    })
    expect(upgraded.upgradeLevel).toBe(1)
    expect(owner.money).toBe(9640)
    expect(stack.amount).toBe(19)
    expect(await testPrisma.upgradeLog.count({ where: { itemInstanceId: item.id } })).toBe(1)
  })
})
