import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { HelpersService, helperEfficiency, helperLevelFromExp } from '../../modules/premium/helpers.service'
import { PremiumService } from '../../modules/premium/premium.service'
import { WorkService } from '../../modules/work/work.service'
import { workerEfficiency } from '../../modules/work/work.formulas'
import { BalanceConfig } from '../../config/balance.config'
import { PREMIUM_PRODUCTS } from '../../../prisma/economy-data'
import { cleanDatabase, testPrisma, uid } from './helpers'

const H = BalanceConfig.strategy.helper

async function player(prefix = 'hp') {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money: 1000 },
  })
}

async function subscribed(prefix = 'sub') {
  const character = await player(prefix)
  await PremiumService.grant({ characterId: character.id, productCode: 'prem_sub_30' })
  return character
}

/**
 * Объект хозяина. С решения заказчика по В10 помощник работает только на
 * своих объектах и объектах бригады: на государственном зарплату платила бы
 * казна, и подписка печатала бы деньги.
 */
async function myObject(ownerId: string, profession = 'scrap_collector', level = 0, slots = 10) {
  return testPrisma.productionObject.create({
    data: {
      code: uid('obj'), name: 'Пункт', type: 'SCRAPYARD', locationId: 'industrial',
      requiredProfessionCode: profession, requiredProfessionLevel: level,
      shiftDurationMinutes: 30, baseSalary: 100, baseProductionExp: 10,
      workerSlots: slots,
      ownerType: 'PRIVATE', ownerCharacterId: ownerId, balance: 10_000,
    },
  })
}

/** Государственный объект — для проверки отказа. */
async function stateObject(profession = 'scrap_collector', level = 0) {
  return testPrisma.productionObject.create({
    data: {
      code: uid('obj'), name: 'Пункт', type: 'SCRAPYARD', locationId: 'industrial',
      requiredProfessionCode: profession, requiredProfessionLevel: level,
      shiftDurationMinutes: 30, baseSalary: 100, baseProductionExp: 10,
      workerSlots: 10,
    },
  })
}

async function seedShop() {
  for (const p of PREMIUM_PRODUCTS) {
    await testPrisma.premiumProduct.create({
      data: {
        code: p.code, name: p.name, description: p.description, kind: p.kind,
        priceRub: p.priceRub, grantCode: p.grantCode, grantValue: p.grantValue, sortOrder: p.sortOrder,
      },
    })
  }
}

/** Домотать смену до конца, не дожидаясь реального часа. */
async function finishShift(shiftId: string) {
  await testPrisma.workShift.update({
    where: { id: shiftId }, data: { endsAt: new Date(Date.now() - 1000) },
  })
}

describe('помощники', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => {
    await cleanDatabase()
    await testPrisma.premiumPurchase.deleteMany()
    await testPrisma.premiumProduct.deleteMany()
    await seedShop()
  })
  afterAll(async () => testPrisma.$disconnect())

  it('без подписки помощника не нанять', async () => {
    const character = await player()
    await expect(HelpersService.hire(character.id, 'Витёк', 'scrap_collector'))
      .rejects.toMatchObject({ code: 'HELP_001' })
  })

  it('подписчик нанимает двоих, третьего нет', async () => {
    const character = await subscribed()
    await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    await HelpersService.hire(character.id, 'Толян', 'supplier')
    await expect(HelpersService.hire(character.id, 'Третий', 'procurer'))
      .rejects.toMatchObject({ code: 'HELP_002' })
    const list = await HelpersService.list(character.id)
    expect(list.slots).toEqual({ used: 2, total: H.maxCount })
  })

  it('неизвестную профессию не нанять', async () => {
    const character = await subscribed()
    await expect(HelpersService.hire(character.id, 'Никто', 'astronaut'))
      .rejects.toMatchObject({ code: 'HELP_003' })
  })

  it('эффективность помощника — 60% от игрока того же уровня', () => {
    for (const level of [0, 1, 2, 3]) {
      expect(helperEfficiency(level)).toBeCloseTo(workerEfficiency(level) * H.efficiency, 6)
    }
  })

  it('два помощника дают ровно нижнюю границу коридора владельца', () => {
    // Ориентир Этапа 3: доход владельца за час 120–160% от смены рабочего.
    expect(2 * H.efficiency).toBeCloseTo(1.2, 6)
  })

  it('навык помощника упирается в свой потолок', () => {
    expect(helperLevelFromExp(10_000_000)).toBe(H.skillCap)
    expect(H.skillCap).toBeLessThan(6) // потолок игрока
  })

  it('смена помощника даёт зарплату с множителем и опыт помощнику', async () => {
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    const object = await myObject(character.id)

    const started = await HelpersService.startShift(character.id, helper.id, object.id)
    await finishShift(started.shiftId)
    const claimed = await HelpersService.claimShift(character.id, helper.id)

    expect(claimed.salary).toBeGreaterThan(0)
    // Опыт ушёл помощнику, а не в профессии хозяина.
    expect(claimed.helper.professionExp).toBeGreaterThan(0)
    const own = await testPrisma.characterProfession.findMany({ where: { characterId: character.id } })
    expect(own).toHaveLength(0)
  })

  it('помощник растёт вдвое медленнее игрока', async () => {
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    const object = await myObject(character.id)
    const started = await HelpersService.startShift(character.id, helper.id, object.id)
    await finishShift(started.shiftId)
    const claimed = await HelpersService.claimShift(character.id, helper.id)
    // Объект даёт 10 базового опыта, помощник получает половину.
    expect(claimed.helper.professionExp).toBeCloseTo(10 * H.skillRate, 6)
  })

  it('смена помощника не блокирует смену хозяина', async () => {
    // Помощник работает ВМЕСТО игрока, а не вместо его дня.
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    const object = await myObject(character.id)
    await HelpersService.startShift(character.id, helper.id, object.id)

    await expect(WorkService.start(character.id, object.id)).resolves.toBeTruthy()
  })

  it('смена помощника не расходует суточный лимит хозяина', async () => {
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    const object = await myObject(character.id)
    const started = await HelpersService.startShift(character.id, helper.id, object.id)
    await finishShift(started.shiftId)
    await HelpersService.claimShift(character.id, helper.id)

    const view = await WorkService.listObjects(character.id)
    expect(view.daily.shiftsUsedToday).toBe(0)
  })

  it('смену помощника нельзя забрать обычной ручкой', async () => {
    // Иначе игрок получал бы полную зарплату и свой опыт, минуя
    // множитель 0.6 и профессию помощника.
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    const object = await myObject(character.id)
    const started = await HelpersService.startShift(character.id, helper.id, object.id)
    await finishShift(started.shiftId)

    await expect(WorkService.claim(character.id, started.shiftId, uid('key')))
      .rejects.toMatchObject({ code: 'WORK_008' })
  })

  it('помощник занимает рабочий слот объекта', async () => {
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    const object = await myObject(character.id, 'scrap_collector', 0, 1)
    await HelpersService.startShift(character.id, helper.id, object.id)
    await expect(WorkService.start(character.id, object.id))
      .rejects.toMatchObject({ code: 'WORK_004' })
  })

  it('занятого помощника не уволить', async () => {
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    const object = await myObject(character.id)
    await HelpersService.startShift(character.id, helper.id, object.id)
    await expect(HelpersService.dismiss(character.id, helper.id))
      .rejects.toMatchObject({ code: 'HELP_004' })
  })

  it('помощник не идёт на верхний передел', async () => {
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Мастер', 'gunsmith')
    const object = await myObject(character.id, 'gunsmith', 2)
    await expect(HelpersService.startShift(character.id, helper.id, object.id))
      .rejects.toMatchObject({ code: 'HELP_005' })
  })

  it('после истечения подписки помощник числится спящим и не работает', async () => {
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    const object = await myObject(character.id)
    await testPrisma.character.update({
      where: { id: character.id },
      data: { premiumExpiresAt: new Date(Date.now() - 1000) },
    })

    const list = await HelpersService.list(character.id)
    expect(list.items[0].status).toBe('DORMANT')
    await expect(HelpersService.startShift(character.id, helper.id, object.id))
      .rejects.toMatchObject({ code: 'HELP_001' })
  })

  it('зарплату помощника платит объект хозяина — деньги не печатаются', async () => {
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    const object = await myObject(character.id)

    const started = await HelpersService.startShift(character.id, helper.id, object.id)
    await finishShift(started.shiftId)
    const claimed = await HelpersService.claimShift(character.id, helper.id)

    const after = await testPrisma.productionObject.findUniqueOrThrow({ where: { id: object.id } })
    // Смысл решения по В10: зарплата переезжает из баланса объекта в карман
    // хозяина, а не появляется из воздуха. Иначе подписка — денежный кран.
    expect(after.balance).toBe(10_000 - claimed.salary)
  })

  it('на чужом и государственном объекте помощник не работает', async () => {
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    const stranger = await player('stranger')

    const state = await stateObject()
    await expect(HelpersService.startShift(character.id, helper.id, state.id))
      .rejects.toMatchObject({ code: 'HELP_007' })

    const foreign = await myObject(stranger.id)
    await expect(HelpersService.startShift(character.id, helper.id, foreign.id))
      .rejects.toMatchObject({ code: 'HELP_007' })
  })

  it('суточная норма помощника — потолок из баланса', async () => {
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    const object = await myObject(character.id)

    for (let i = 0; i < H.dailyShiftCap; i++) {
      const started = await HelpersService.startShift(character.id, helper.id, object.id)
      await finishShift(started.shiftId)
      await HelpersService.claimShift(character.id, helper.id)
    }
    await expect(HelpersService.startShift(character.id, helper.id, object.id))
      .rejects.toMatchObject({ code: 'HELP_006' })
  })
})
