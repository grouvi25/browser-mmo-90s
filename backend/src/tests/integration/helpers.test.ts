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
    const object = await stateObject()

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
    const object = await stateObject()
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
    const object = await stateObject()
    await HelpersService.startShift(character.id, helper.id, object.id)

    await expect(WorkService.start(character.id, object.id)).resolves.toBeTruthy()
  })

  it('смена помощника не расходует суточный лимит хозяина', async () => {
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    const object = await stateObject()
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
    const object = await stateObject()
    const started = await HelpersService.startShift(character.id, helper.id, object.id)
    await finishShift(started.shiftId)

    await expect(WorkService.claim(character.id, started.shiftId, uid('key')))
      .rejects.toMatchObject({ code: 'WORK_008' })
  })

  it('помощник занимает рабочий слот объекта', async () => {
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    const object = await testPrisma.productionObject.create({
      data: {
        code: uid('tight'), name: 'Тесный', type: 'SCRAPYARD', locationId: 'industrial',
        requiredProfessionCode: 'scrap_collector', requiredProfessionLevel: 0,
        shiftDurationMinutes: 30, baseSalary: 100, baseProductionExp: 10, workerSlots: 1,
      },
    })
    await HelpersService.startShift(character.id, helper.id, object.id)
    await expect(WorkService.start(character.id, object.id))
      .rejects.toMatchObject({ code: 'WORK_004' })
  })

  it('занятого помощника не уволить', async () => {
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    const object = await stateObject()
    await HelpersService.startShift(character.id, helper.id, object.id)
    await expect(HelpersService.dismiss(character.id, helper.id))
      .rejects.toMatchObject({ code: 'HELP_004' })
  })

  it('помощник не идёт на верхний передел', async () => {
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Мастер', 'gunsmith')
    const object = await stateObject('gunsmith', 2)
    await expect(HelpersService.startShift(character.id, helper.id, object.id))
      .rejects.toMatchObject({ code: 'HELP_005' })
  })

  it('после истечения подписки помощник числится спящим и не работает', async () => {
    const character = await subscribed()
    const helper = await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    const object = await stateObject()
    await testPrisma.character.update({
      where: { id: character.id },
      data: { premiumExpiresAt: new Date(Date.now() - 1000) },
    })

    const list = await HelpersService.list(character.id)
    expect(list.items[0].status).toBe('DORMANT')
    await expect(HelpersService.startShift(character.id, helper.id, object.id))
      .rejects.toMatchObject({ code: 'HELP_001' })
  })

  it('зарплату помощника платит объект, если он частный', async () => {
    const character = await subscribed()
    const owner = await player('owner')
    const helper = await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')
    const object = await stateObject()
    await testPrisma.productionObject.update({
      where: { id: object.id },
      data: { ownerType: 'PRIVATE', ownerCharacterId: owner.id, balance: 10_000 },
    })

    const started = await HelpersService.startShift(character.id, helper.id, object.id)
    await finishShift(started.shiftId)
    const claimed = await HelpersService.claimShift(character.id, helper.id)

    const after = await testPrisma.productionObject.findUniqueOrThrow({ where: { id: object.id } })
    // Помощник не бесплатная рабочая сила для чужого объекта.
    expect(after.balance).toBe(10_000 - claimed.salary)
  })
})
