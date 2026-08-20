import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FarmService } from '../../modules/farm/farm.service'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function player(prefix: string, money = 100_000) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money },
  })
}

describe('farm', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  it('lazily creates the first free plot and reports it as owned', async () => {
    const character = await player('farmer1')
    const state = await FarmService.list(character.id)
    expect(state.plots).toHaveLength(1)
    expect(state.plots[0].slot).toBe(1)
    expect(state.plots[0].state).toBe('EMPTY')
    expect(state.nextPlotPrice).toBe(1500) // второй-третий участок по ТЗ
  })

  it('buys the second plot for 1500 and debits money', async () => {
    const character = await player('farmer2')
    await FarmService.list(character.id) // создаёт первый бесплатный участок
    const { plot, cost, newBalance } = await FarmService.buyPlot(character.id)
    expect(cost).toBe(1500)
    expect(plot.slot).toBe(2)
    expect(newBalance).toBe(100_000 - 1500)
  })

  it('plants dill, waters it once and harvests within the configured range', async () => {
    await testPrisma.resourceTemplate.upsert({
      where: { code: 'res_greens' }, update: {},
      create: { code: 'res_greens', name: 'Зелень', category: 'PRIMARY', tier: 1, basePrice: 20, weight: 0.1 },
    })
    const character = await player('farmer3')
    await FarmService.list(character.id)
    const plots = await testPrisma.farmPlot.findMany({ where: { characterId: character.id } })
    const plotId = plots[0].id

    const planted = await FarmService.plant(character.id, plotId, 'dill')
    expect(planted.newBalance).toBe(100_000 - 20) // цена семян укропа

    const watered = await FarmService.water(character.id, plotId)
    expect(watered.waterCount).toBe(1)
    expect(watered.readyAt!.getTime()).toBeLessThan(planted.plot.readyAt!.getTime())

    // созревание в прошлом — не ждём реальные 15 минут в тесте
    await testPrisma.farmPlot.update({ where: { id: plotId }, data: { readyAt: new Date(Date.now() - 1000) } })
    const harvest = await FarmService.harvest(character.id, plotId)
    expect(harvest.cropCode).toBe('dill')
    expect(harvest.amount).toBeGreaterThanOrEqual(2)
    expect(harvest.amount).toBeLessThanOrEqual(3)

    const stack = await testPrisma.resourceStack.findFirst({ where: { characterId: character.id } })
    expect(stack?.amount).toBe(harvest.amount)

    const after = await testPrisma.farmPlot.findUniqueOrThrow({ where: { id: plotId } })
    expect(after.cropCode).toBeNull() // участок освобождается после сбора
  })

  it('rejects harvest before the crop is ready and rejects a second planting on a busy plot', async () => {
    const character = await player('farmer4')
    await FarmService.list(character.id)
    const plot = await testPrisma.farmPlot.findFirstOrThrow({ where: { characterId: character.id } })

    await FarmService.plant(character.id, plot.id, 'dill')
    await expect(FarmService.harvest(character.id, plot.id)).rejects.toThrow()
    await expect(FarmService.plant(character.id, plot.id, 'dill')).rejects.toThrow()
  })

  it('buys a barrel building that is not tied to a specific plot twice', async () => {
    const character = await player('farmer5')
    await FarmService.list(character.id)
    const plot = await testPrisma.farmPlot.findFirstOrThrow({ where: { characterId: character.id } })
    const { building, newBalance } = await FarmService.buyBuilding(character.id, plot.id, 'BARREL')
    expect(building.type).toBe('BARREL')
    expect(newBalance).toBe(100_000 - 2500)
    await expect(FarmService.buyBuilding(character.id, plot.id, 'BARREL')).rejects.toThrow()
  })
})
