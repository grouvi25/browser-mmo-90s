/**
 * Частные заводы (обещание игрокам 23.10): «на работу устраиваются игроки,
 * получают зарплату, а владелец завода получает ресурсы, которые остаются
 * у него. И он может перерабатывать или продавать их».
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { getRedis, disconnectRedis } from '../../shared/db/redis'
import { WorkService } from '../../modules/work/work.service'
import { OwnershipService } from '../../modules/production/ownership.service'
import { ProductionService } from '../../modules/production/production.service'
import { runWorkShiftFinalize } from '../../workers/work-shift-finalize.worker'

async function player(prefix: string, money: number) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money, dollars: 6000 } })
  await testPrisma.characterProfession.create({ data: { characterId: character.id, professionCode: 'scrap_collector' } })
  return character
}

async function fixture() {
  const resource = await testPrisma.resourceTemplate.create({ data: { code: uid('scrap'), name: 'Лом', category: 'PRIMARY', tier: 1, basePrice: 8, weight: 0.5 } })
  const object = await testPrisma.productionObject.create({
    data: {
      code: uid('obj'), name: 'Пункт металлолома', type: 'SCRAPYARD', requiredProfessionCode: 'scrap_collector', requiredProfessionLevel: 0,
      shiftDurationMinutes: 30, baseSalary: 80, baseProductionExp: 10, producesResourceCode: resource.code, outputAmountMin: 2, outputAmountMax: 4,
      purchasePrice: 2000, isForSale: true, storageCapacity: 1000,
    },
  })
  const owner = await player('owner', 10_000)
  const worker = await player('worker', 0)
  await OwnershipService.buy(owner.id, object.id, uid('buy'))
  return { resource, object, owner, worker }
}

async function workOneShift(characterId: string, objectId: string) {
  const started = await WorkService.start(characterId, objectId)
  await testPrisma.workShift.update({ where: { id: started.shift.id }, data: { endsAt: new Date(Date.now() - 1000) } })
  await runWorkShiftFinalize()
  return WorkService.claim(characterId, started.shift.id, uid('claim'))
}

describe('частный завод', () => {
  beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })
  afterAll(async () => { await testPrisma.$disconnect(); await disconnectRedis() })

  it('без денег в кассе наёмник смену не начинает, а сам владелец — может', async () => {
    const { object, owner, worker } = await fixture()
    await expect(WorkService.start(worker.id, object.id)).rejects.toMatchObject({ code: 'WORK_015' })
    const view = (await WorkService.listObjects(worker.id)).items.find(item => item.id === object.id)
    expect(view?.employer).toMatchObject({ nickname: owner.nickname, isMe: false, canPay: false })
    await expect(WorkService.start(owner.id, object.id)).resolves.toBeTruthy()
  })

  it('наёмнику — зарплата из кассы, сырьё — владельцу', async () => {
    const { resource, object, owner, worker } = await fixture()
    await OwnershipService.topUp(owner.id, object.id, 1000, uid('fund'))
    const claimed = await workOneShift(worker.id, object.id)
    expect(claimed.salary).toBeGreaterThan(0)
    expect(claimed.resourceReward).toBeNull()
    expect(claimed.resourceToOwner?.amount).toBeGreaterThanOrEqual(2)
    const ownerStack = await testPrisma.resourceStack.findFirst({ where: { characterId: owner.id, template: { code: resource.code } } })
    expect(ownerStack?.amount).toBe(claimed.resourceToOwner?.amount)
    expect(await testPrisma.resourceStack.count({ where: { characterId: worker.id } })).toBe(0)
    const after = await testPrisma.productionObject.findUniqueOrThrow({ where: { id: object.id } })
    expect(after.balance).toBe(1000 - claimed.salary)
    // Владелец видит, кто отработал и сколько выплачено.
    const [mine] = await ProductionService.mine(owner.id)
    expect(mine.day).toEqual({ shifts: 1, salaryPaid: claimed.salary })
  })

  it('склад объекта: положить своё сырьё и забрать обратно', async () => {
    const { resource, object, owner, worker } = await fixture()
    await OwnershipService.topUp(owner.id, object.id, 1000, uid('fund'))
    const { resourceToOwner } = await workOneShift(worker.id, object.id)
    const got = resourceToOwner!.amount
    const put = await OwnershipService.stockPut(owner.id, object.id, resource.code, 2, uid('put'))
    expect(put.objectAmount).toBe(2)
    await expect(OwnershipService.stockPut(owner.id, object.id, resource.code, got, uid('put'))).rejects.toMatchObject({ code: 'RES_003' })
    await expect(OwnershipService.stockTake(worker.id, object.id, resource.code, 1, uid('take'))).rejects.toMatchObject({ code: 'PROD_008' })
    await expect(OwnershipService.stockTake(owner.id, object.id, resource.code, 3, uid('take'))).rejects.toMatchObject({ code: 'PROD_012' })
    const taken = await OwnershipService.stockTake(owner.id, object.id, resource.code, 2, uid('take'))
    expect(taken).toMatchObject({ amount: 2, ownAmount: got, objectLeft: 0 })
    const [mine] = await ProductionService.mine(owner.id)
    expect(mine.inventory.every(row => row.amount === 0)).toBe(true)
  })
})
