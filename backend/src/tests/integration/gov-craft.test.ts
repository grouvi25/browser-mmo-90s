/**
 * Госкрафт (обещание игрокам 04.11 «будет гос крафт»): в некупленном цехе игрок
 * делает рецепт из своего сырья и забирает изделие. Раньше такой цех стоял
 * закрытым с табличкой «продаётся», и крафта у игроков не было вовсе.
 * Плюс честный суточный лимит: рецепт, который не влезает в оставшиеся минуты дня, помечен заранее.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { disconnectRedis, getRedis } from '../../shared/db/redis'
import { WorkService } from '../../modules/work/work.service'
import { runWorkShiftFinalize } from '../../workers/work-shift-finalize.worker'
import { BalanceConfig } from '../../config/balance.config'

async function fixture(scrap = 10) {
  const login = uid('gc')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money: 100 } })
  await testPrisma.characterProfession.create({ data: { characterId: character.id, professionCode: 'toolmaker' } })
  const input = await testPrisma.resourceTemplate.create({ data: { code: uid('scrap'), name: 'Лом', category: 'PRIMARY', tier: 1, basePrice: 8, weight: 0.5 } })
  const blank = await testPrisma.resourceTemplate.create({ data: { code: uid('blank'), name: 'Заготовка', category: 'PRIMARY', tier: 2, basePrice: 40, weight: 1 } })
  if (scrap > 0) await testPrisma.resourceStack.create({ data: { characterId: character.id, resourceTemplateId: input.id, amount: scrap } })
  const vest = await testPrisma.itemTemplate.create({ data: { code: uid('vest'), name: 'Жилет', type: 'ARMOR', armorSlot: 'CHEST', weight: 3, durabilityMax: 100, priceBase: 500, allocationMode: 'PLAYER', statBudget: 20 } })
  const object = await testPrisma.productionObject.create({ data: {
    code: uid('shop'), name: 'Мастерская', type: 'WORKSHOP', requiredProfessionCode: 'toolmaker', requiredProfessionLevel: 0,
    shiftDurationMinutes: 60, baseSalary: 0, baseProductionExp: 20, isForSale: true,
  } })
  const toBlank = await testPrisma.productionRecipe.create({ data: {
    code: uid('rcp'), name: 'Заготовка', productionObjectCode: object.code, outputResourceCode: blank.code, outputAmount: 1,
    cycleMinutes: 50, laborRequired: 50, requiredProfessionCode: 'toolmaker', requiredToolTier: 0,
    inputs: { create: [{ resourceCode: input.code, amount: 4 }] },
  } })
  const toVest = await testPrisma.productionRecipe.create({ data: {
    code: uid('rcp'), name: 'Жилет', productionObjectCode: object.code, outputItemTemplateCode: vest.code, outputAmount: 1,
    cycleMinutes: 60, laborRequired: 60, requiredProfessionCode: 'toolmaker', requiredToolTier: 0,
    inputs: { create: [{ resourceCode: blank.code, amount: 1 }] },
  } })
  const expert = await testPrisma.productionRecipe.create({ data: {
    code: uid('rcp'), name: 'Сложное', productionObjectCode: object.code, outputResourceCode: blank.code, outputAmount: 1,
    cycleMinutes: 50, laborRequired: 50, requiredProfessionCode: 'toolmaker', requiredProfessionLevel: 3, requiredToolTier: 0,
  } })
  const stack = (templateId: string) => testPrisma.resourceStack.findUnique({ where: { characterId_resourceTemplateId: { characterId: character.id, resourceTemplateId: templateId } } })
  /** Смена готова к получению, отдых после неё уже прошёл. */
  const finish = async (shiftId: string) => {
    await testPrisma.workShift.update({ where: { id: shiftId }, data: { startedAt: new Date(Date.now() - 3 * 3_600_000), endsAt: new Date(Date.now() - 2 * 3_600_000) } })
    await runWorkShiftFinalize()
  }
  return { character, object, input, blank, vest, toBlank, toVest, expert, stack, finish }
}

describe('госкрафт', () => {
  // Длительность рецептов проверяется номинальной; 5-минутные смены — в short-shifts.test.ts.
  beforeAll(async () => { BalanceConfig.economy.work.realShiftMinutes = 0; await testPrisma.$connect(); await getRedis().ping() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })
  afterAll(async () => { BalanceConfig.economy.work.realShiftMinutes = 5; await testPrisma.$disconnect(); await disconnectRedis() })

  it('цех виден с рецептами: что выйдет, сколько сырья есть и чего не хватает', async () => {
    const { character, object } = await fixture(2)
    const view = (await WorkService.listObjects(character.id)).items.find(item => item.id === object.id)!
    expect(view.forSaleUsd).toBeGreaterThan(0)
    const blank = view.craft!.find(recipe => recipe.name === 'Заготовка')!
    expect(blank).toMatchObject({ minutes: 50, output: { name: 'Заготовка', amount: 1 }, inputs: [{ name: 'Лом', need: 4, have: 2 }] })
    expect(blank.reason).toBe('Не хватает: Лом 2/4')
    expect(view.craft!.find(recipe => recipe.name === 'Сложное')!.reason).toBe('Нужен 3 уровень профессии')
  })

  it('без выбранного рецепта и без сырья смена не начинается, ничего не резервируется', async () => {
    const { character, object, toBlank, expert, input, stack } = await fixture(2)
    await expect(WorkService.start(character.id, object.id)).rejects.toMatchObject({ statusCode: 409 })
    await expect(WorkService.start(character.id, object.id, toBlank.id)).rejects.toMatchObject({ statusCode: 409, message: 'Не хватает сырья: Лом, нужно 4' })
    await expect(WorkService.start(character.id, object.id, expert.id)).rejects.toMatchObject({ statusCode: 400 })
    expect(await stack(input.id)).toMatchObject({ amount: 2, reservedAmount: 0 })
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).status).toBe('ACTIVE')
  })

  it('смена делает изделие из своего сырья: резерв, списание, вещь игроку, опыт без зарплаты', async () => {
    const { character, object, toBlank, toVest, input, blank, vest, stack, finish } = await fixture(10)
    const first = await WorkService.start(character.id, object.id, toBlank.id)
    expect(first.shift.endsAt.getTime() - first.shift.startedAt.getTime()).toBe(50 * 60_000)
    expect(await stack(input.id)).toMatchObject({ amount: 10, reservedAmount: 4 })
    await finish(first.shift.id)
    const claimed = await WorkService.claim(character.id, first.shift.id, uid('key'))
    expect(claimed).toMatchObject({ salary: 0, crafted: { kind: 'resource', name: 'Заготовка', amount: 1 } })
    expect(claimed.professionExpGain).toBeGreaterThan(0)
    expect(await stack(input.id)).toMatchObject({ amount: 6, reservedAmount: 0 })
    expect(await stack(blank.id)).toMatchObject({ amount: 1 })

    const second = await WorkService.start(character.id, object.id, toVest.id)
    await finish(second.shift.id)
    expect(await WorkService.claim(character.id, second.shift.id, uid('key'))).toMatchObject({ crafted: { kind: 'item', name: 'Жилет' } })
    const item = await testPrisma.itemInstance.findFirstOrThrow({ where: { ownerId: character.id, templateId: vest.id } })
    // Игрок сам раскладывает очки изделия (заказчик 04.11).
    expect(item).toMatchObject({ sourceType: 'CRAFTED', freePoints: 20 })
    expect(await stack(blank.id)).toMatchObject({ amount: 0 })
  })

  it('отмена смены возвращает сырьё', async () => {
    const { character, object, toBlank, input, stack } = await fixture(4)
    const started = await WorkService.start(character.id, object.id, toBlank.id)
    await WorkService.cancel(character.id, started.shift.id)
    expect(await stack(input.id)).toMatchObject({ amount: 4, reservedAmount: 0 })
  })

  it('купленный цех работает по-старому: рецепт игрока не нужен, своё сырьё не трогается', async () => {
    const { character, object, input, stack } = await fixture(10)
    await testPrisma.productionObject.update({ where: { id: object.id }, data: { ownerType: 'PRIVATE', ownerCharacterId: character.id, isForSale: false } })
    const view = (await WorkService.listObjects(character.id)).items.find(item => item.id === object.id)!
    expect(view.craft).toBeNull()
    const started = await WorkService.start(character.id, object.id)
    expect(started.shift.craftRecipeId).toBeNull()
    expect(await stack(input.id)).toMatchObject({ amount: 10, reservedAmount: 0 })
  })

  it('партия: 5 шт. за одну смену, сырьё и износ ×5, время то же; экран знает, сколько можно (Дима 10.11)', async () => {
    const { character, object, toBlank, input, blank, stack, finish } = await fixture(22)
    const hammer = await testPrisma.itemTemplate.create({ data: { code: uid('hammer'), name: 'Молот', type: 'TOOL', toolTier: 1, usesMax: 7, weight: 1, durabilityMax: 100, priceBase: 50 } })
    await testPrisma.productionRecipe.update({ where: { id: toBlank.id }, data: { requiredToolCode: hammer.code } })
    const tool = await testPrisma.itemInstance.create({ data: { templateId: hammer.id, ownerId: character.id, sourceType: 'GOVERNMENT', usesLeft: 7, durabilityCurrent: 100, durabilityMax: 100, weight: 1 } })

    const view = (await WorkService.listObjects(character.id)).items.find(item => item.id === object.id)!
    // Сырья на 5 (22 / 4), инструмента на 7: потолок 5.
    expect(view.craft!.find(recipe => recipe.name === 'Заготовка')).toMatchObject({ quantities: [1, 3, 5, 10], maxQuantity: 5 })

    await expect(WorkService.start(character.id, object.id, toBlank.id, 10)).rejects.toMatchObject({ statusCode: 400 })
    const started = await WorkService.start(character.id, object.id, toBlank.id, 5)
    expect(started.shift).toMatchObject({ craftQuantity: 5 })
    expect(started.shift.endsAt.getTime() - started.shift.startedAt.getTime()).toBe(50 * 60_000)
    expect(await stack(input.id)).toMatchObject({ amount: 22, reservedAmount: 20 })
    await finish(started.shift.id)
    const claimed = await WorkService.claim(character.id, started.shift.id, uid('key'))
    expect(claimed).toMatchObject({ crafted: { kind: 'resource', amount: 5 }, toolUse: { usesLeft: 2 } })
    expect(await stack(input.id)).toMatchObject({ amount: 2, reservedAmount: 0 })
    expect(await stack(blank.id)).toMatchObject({ amount: 5 })
    expect(await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: tool.id } })).toMatchObject({ usesLeft: 2, status: 'NORMAL' })
  })

  it('отмена партии возвращает всё сырьё, а инструмент не изнашивается', async () => {
    const { character, object, toBlank, input, stack } = await fixture(12)
    const started = await WorkService.start(character.id, object.id, toBlank.id, 3)
    expect(await stack(input.id)).toMatchObject({ amount: 12, reservedAmount: 12 })
    await WorkService.cancel(character.id, started.shift.id)
    expect(await stack(input.id)).toMatchObject({ amount: 12, reservedAmount: 0 })
  })

  it('на смену — с 90% здоровья, экран заранее пишет причину (обращение №61)', async () => {
    const { character, object, toBlank, input, stack } = await fixture(10)
    await testPrisma.character.update({ where: { id: character.id }, data: { hpCurrent: 71 } })
    expect((await WorkService.listObjects(character.id)).hpGate).toEqual({ need: 72, have: 71 })
    await expect(WorkService.start(character.id, object.id, toBlank.id)).rejects.toMatchObject({ statusCode: 409, message: 'На смену — с 90% здоровья: сейчас 71 из 80, нужно 72' })
    expect(await stack(input.id)).toMatchObject({ reservedAmount: 0 })
    await testPrisma.character.update({ where: { id: character.id }, data: { hpCurrent: 72 } })
    await expect(WorkService.start(character.id, object.id, toBlank.id)).resolves.toBeTruthy()
  })

  it('рецепт, который не влезает в оставшееся время дня, помечен и не начинается (обращения №38, №42, №47)', async () => {
    const { character, object, toBlank } = await fixture(40)
    await testPrisma.productionObject.update({ where: { id: object.id }, data: { baseSalary: 100, isForSale: false, shiftDurationMinutes: 50 } })
    for (let i = 0; i < 7; i++) {
      const s = await WorkService.start(character.id, object.id)
      await WorkService.cancel(character.id, s.shift.id)
    }
    await testPrisma.productionObject.update({ where: { id: object.id }, data: { baseSalary: 0, isForSale: true } })
    // 7 × 50 = 350 из 360 минут: смена на 50 минут уже не влезает.
    const view = (await WorkService.listObjects(character.id)).items.find(item => item.id === object.id)!
    expect(view.craft!.find(recipe => recipe.name === 'Заготовка')!.reason).toBe('Не хватит времени сегодня: осталось 10 мин, нужно 50')
    await expect(WorkService.start(character.id, object.id, toBlank.id)).rejects.toMatchObject({ statusCode: 400 })
  })
})
