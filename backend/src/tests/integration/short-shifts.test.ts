/**
 * Короткие смены (заказчик 06.11, обращение №42): «время работ 5 минут, отдых не
 * увеличивать». Смена длится 5 минут, в день влезают все 12 смен, а труд в цикл
 * цеха идёт по длительности объекта — короткая смена не растягивает производство.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { disconnectRedis, getRedis } from '../../shared/db/redis'
import { BalanceConfig } from '../../config/balance.config'
import { WorkService } from '../../modules/work/work.service'
import { laborFromShift } from '../../modules/production/cycle.formulas'
import { workerEfficiency } from '../../modules/work/work.formulas'

async function worker() {
  const login = uid('ss')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money: 100 } })
  await testPrisma.characterProfession.create({ data: { characterId: character.id, professionCode: 'toolmaker' } })
  return character
}
const object = (data: Record<string, unknown> = {}) => testPrisma.productionObject.create({ data: {
  code: uid('obj'), name: 'Мастерская', type: 'WORKSHOP', requiredProfessionCode: 'toolmaker', shiftDurationMinutes: 60, baseSalary: 100, baseProductionExp: 20, ...data,
} })

describe('смена 5 минут', () => {
  beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })
  afterAll(async () => { await testPrisma.$disconnect(); await disconnectRedis() })

  it('часовая по номиналу смена длится 5 минут, и экран показывает 5', async () => {
    expect(BalanceConfig.economy.work.realShiftMinutes).toBe(5)
    const me = await worker(); const shop = await object()
    const { shift } = await WorkService.start(me.id, shop.id)
    expect(shift.endsAt.getTime() - shift.startedAt.getTime()).toBe(5 * 60_000)
    const view = (await WorkService.listObjects(me.id)).items.find(item => item.id === shop.id)!
    expect(view.shiftDurationMinutes).toBe(5)
  })

  it('в день влезают все 12 смен, тринадцатая — нет (обращения №38, №42, №47)', async () => {
    const me = await worker(); const shop = await object()
    for (let i = 0; i < 12; i++) {
      const { shift } = await WorkService.start(me.id, shop.id)
      await WorkService.cancel(me.id, shift.id)
    }
    expect((await WorkService.current(me.id)).daily).toMatchObject({ shiftsUsedToday: 12, minutesUsedToday: 60 })
    await expect(WorkService.start(me.id, shop.id)).rejects.toMatchObject({ statusCode: 400, message: 'Лимит смен на сегодня исчерпан' })
  })

  it('труд в цикл цеха — по длительности объекта, а не по 5 минутам', async () => {
    const owner = await worker(); const me = await worker()
    const shop = await object({ ownerType: 'PRIVATE', ownerCharacterId: owner.id, balance: 10_000 })
    const recipe = await testPrisma.productionRecipe.create({ data: {
      code: uid('rcp'), name: 'Молот', productionObjectCode: shop.code, outputResourceCode: null, cycleMinutes: 50, laborRequired: 1_000, requiredProfessionCode: 'toolmaker',
    } })
    await testPrisma.productionObject.update({ where: { id: shop.id }, data: { activeRecipeId: recipe.id } })
    await testPrisma.productionCycle.create({ data: { productionObjectId: shop.id, recipeId: recipe.id, status: 'PENDING', laborRequired: 1_000 } })
    const { shift } = await WorkService.start(me.id, shop.id)
    await testPrisma.workShift.update({ where: { id: shift.id }, data: { status: 'READY_TO_CLAIM' } })
    const claimed = await WorkService.claim(me.id, shift.id, uid('key'))
    expect(claimed.cycleContribution?.laborMinutes).toBe(laborFromShift(60, workerEfficiency(0)))
  })
})
