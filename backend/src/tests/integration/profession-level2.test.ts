/**
 * Второй уровень профессии в Училище за доллары (правка заказчика 28.10):
 * с ним добытчик продаёт ресурсы на рынке за доллары.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CityService } from '../../modules/city/city.service'
import { CityConfig } from '../../modules/city/city.config'
import { assertCanList } from '../../modules/market/trader'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function player(dollars: number) {
  const login = uid('sch')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({ data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'WORKER', hpCurrent: 80, hpMax: 80, dollars } })
}

describe('2-й уровень профессии за доллары', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  it('поднимает изученную профессию до 2-го уровня и открывает продажу ресурсов за доллары', async () => {
    const price = CityConfig.professionLevel2Usd
    const char = await player(price + 5)
    await expect(CityService.buyLevel2(char.id, 'scrap_collector', uid('k'))).rejects.toMatchObject({ statusCode: 409 })
    await testPrisma.characterProfession.create({ data: { characterId: char.id, professionCode: 'scrap_collector' } })
    await expect(testPrisma.$transaction(tx => assertCanList(tx, char.id, 'RESOURCE', 'USD'))).rejects.toMatchObject({ statusCode: 403 })

    const result = await CityService.buyLevel2(char.id, 'scrap_collector', uid('k'))
    expect(result.profession).toMatchObject({ level: 2, exp: 1500 })
    expect(result.dollars).toBe(5)
    await expect(testPrisma.$transaction(tx => assertCanList(tx, char.id, 'RESOURCE', 'USD'))).resolves.toBeUndefined()
    await expect(CityService.buyLevel2(char.id, 'scrap_collector', uid('k'))).rejects.toMatchObject({ statusCode: 409 })
  })

  it('без долларов не поднимает', async () => {
    const char = await player(0)
    await testPrisma.characterProfession.create({ data: { characterId: char.id, professionCode: 'scrap_collector' } })
    await expect(CityService.buyLevel2(char.id, 'scrap_collector', uid('k'))).rejects.toMatchObject({ code: 'ECON_002' })
    expect((await testPrisma.characterProfession.findFirstOrThrow({ where: { characterId: char.id } })).level).toBe(0)
  })
})
