/**
 * Обращения №29 и №30: отдых после смены виден до нажатия «Выйти», а экран
 * ремонта называет деталь, которой не хватает, и лавку, где она продаётся.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { WorkService } from '../../modules/work/work.service'
import { BalanceConfig } from '../../config/balance.config'
import { buildApp } from '../../app'
import { AuthService } from '../../modules/auth/auth.service'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function player() {
  const login = uid('rr')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money: 5000 },
  })
  return { user, character }
}

async function object(profession = 'scrap_collector') {
  return testPrisma.productionObject.create({
    data: {
      code: uid('obj'), name: 'Пункт', type: 'SCRAPYARD', locationId: 'industrial',
      requiredProfessionCode: profession, requiredProfessionLevel: 0,
      shiftDurationMinutes: 30, baseSalary: 100, baseProductionExp: 10, workerSlots: 10,
    },
  })
}

describe('подсказки работы и ремонта', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  it('отдых виден в списке и в текущей смене, пока не кончится', async () => {
    const { character } = await player()
    const place = await object()
    await testPrisma.characterProfession.create({ data: { characterId: character.id, professionCode: 'scrap_collector' } })

    expect((await WorkService.listObjects(character.id)).restUntil).toBeNull()
    expect((await WorkService.current(character.id)).restUntil).toBeNull()

    const restMs = BalanceConfig.economy.work.restMinutesAfterShift * 60_000
    const endedAt = new Date(Date.now() - 60_000)
    await testPrisma.workShift.create({
      data: {
        characterId: character.id, productionObjectId: place.id, professionCode: 'scrap_collector',
        status: 'CLAIMED', startedAt: new Date(endedAt.getTime() - 30 * 60_000), endsAt: endedAt, baseSalary: 100,
      },
    })

    const expected = endedAt.getTime() + restMs
    expect((await WorkService.listObjects(character.id)).restUntil?.getTime()).toBe(expected)
    expect((await WorkService.current(character.id)).restUntil?.getTime()).toBe(expected)
    await expect(WorkService.start(character.id, place.id)).rejects.toMatchObject({ code: 'WORK_014' })

    await testPrisma.workShift.updateMany({
      where: { characterId: character.id },
      data: { endsAt: new Date(Date.now() - restMs - 1000) },
    })
    expect((await WorkService.listObjects(character.id)).restUntil).toBeNull()
    await expect(WorkService.start(character.id, place.id)).resolves.toBeTruthy()
    expect((await WorkService.current(character.id)).restUntil).toBeNull()
  })

  it('смена помощника хозяина не держит: отдыха нет', async () => {
    const { character } = await player()
    const place = await object()
    const helper = await testPrisma.helper.create({ data: { characterId: character.id, name: 'Витёк', professionCode: 'scrap_collector' } })
    await testPrisma.workShift.create({
      data: {
        characterId: character.id, productionObjectId: place.id, professionCode: 'scrap_collector', helperId: helper.id,
        status: 'CLAIMED', startedAt: new Date(Date.now() - 31 * 60_000), endsAt: new Date(Date.now() - 60_000), baseSalary: 100,
      },
    })
    expect((await WorkService.listObjects(character.id)).restUntil).toBeNull()
  })

  it('ремонт называет деталь, сколько её есть и где купить', async () => {
    const login = uid('rrp')
    const { id: userId } = await AuthService.register({ login, email: `${login}@test.local`, password: 'pass_for_test_1' })
    const character = await testPrisma.character.create({
      data: { userId, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money: 5000 },
    })
    const part = await testPrisma.resourceTemplate.create({
      data: { code: uid('part'), name: 'Оружейная деталь', category: 'REPAIR_PART', basePrice: 200, isRepairMaterial: true },
    })
    await testPrisma.privateShopItem.create({ data: { shopCode: 'armory_garage', resourceTemplateId: part.id, price: 90 } })
    const template = await testPrisma.itemTemplate.create({
      data: {
        code: uid('tt'), name: 'Пистолет ТТ', type: 'WEAPON', weight: 1, durabilityMax: 100, priceBase: 1000,
        itemTier: 2, repairResourceCode: part.code, isSellable: true,
      },
    })
    await testPrisma.itemInstance.create({
      data: { templateId: template.id, ownerId: character.id, durabilityCurrent: 28, durabilityMax: 100, weight: 1, sourceType: 'PRIVATE' },
    })

    const app = await buildApp()
    const { token } = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login, password: 'pass_for_test_1' } })).json() as { token: string }
    const res = await app.inject({ method: 'GET', url: '/api/repair/items', headers: { authorization: `Bearer ${token}` } })
    await app.close()

    expect(res.statusCode).toBe(200)
    const [row] = res.json() as Array<Record<string, unknown>>
    expect(row).toMatchObject({
      needsParts: true, partsName: 'Оружейная деталь', requiredPartsAmount: 2, partsAvailable: 0, partsEnough: false,
      partsSoldAt: [{ shopCode: 'armory_garage', shopName: 'Оружейный гараж', price: 90 }],
    })
  })
})
