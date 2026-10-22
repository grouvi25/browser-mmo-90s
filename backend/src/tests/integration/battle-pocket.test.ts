/**
 * Карман в бою (правка заказчика 22.10: «нет карманов, в бою нельзя
 * использовать»). Карман берётся из сохранённого на сервере набора, а
 * отказ в использовании — обычный ответ 400, а не падение процесса:
 * необработанное отклонение под замком боя роняло бэкенд целиком.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BattleService } from '../../modules/battles/battles.service'
import { CharactersService } from '../../modules/characters/characters.service'
import { AppError } from '../../shared/errors/app-error'
import { disconnectRedis, getRedis } from '../../shared/db/redis'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function setup() {
  const login = uid('pocket')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'ATHLETE', hpCurrent: 40, hpMax: 100, battleLevel: 3 },
  })
  await testPrisma.characterStats.create({
    data: { characterId: character.id, str: 5, agi: 5, rea: 5, acc: 5, end: 5, luck: 5, agr: 5, auth: 5 },
  })
  const bandage = await testPrisma.itemTemplate.create({
    data: { code: uid('bandage'), name: 'Бинт', type: 'CONSUMABLE', hpBonus: 20, weight: 0, durabilityMax: 1, priceBase: 50 },
  })
  const [inPocket, notInPocket] = await Promise.all([0, 1].map(() => testPrisma.itemInstance.create({
    data: { templateId: bandage.id, ownerId: character.id, durabilityCurrent: 1, durabilityMax: 1, weight: 0, sourceType: 'GOVERNMENT' },
  })))
  const bot = await testPrisma.bot.create({
    data: { code: uid('bot'), name: 'Хулиган', battleLevel: 1, hpMax: 60, stats: {}, equipment: {} },
  })
  return { user, character, inPocket, notInPocket, bot }
}

describe('карман в бою', () => {
  beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })
  afterAll(async () => { await testPrisma.$disconnect(); await disconnectRedis() })

  it('набор из Склада попадает в бой, чужая вещь — отказ 400 без падения', async () => {
    const { user, inPocket, notInPocket, bot } = await setup()
    await CharactersService.setBattleLoadout(user.id, [inPocket.id])

    const { battleId } = await BattleService.startPve(user.id, bot.code) as { battleId: string }
    const state = await BattleService.getBattle(battleId, user.id)
    const mine = (state.liveState as { participants: Array<{ characterId?: string; pocketItemIds?: string[] }> })
      .participants.find(p => p.pocketItemIds)
    expect(mine?.pocketItemIds).toEqual([inPocket.id])

    const refused = await BattleService.submitAction(user.id, battleId, { action: 'use_item', itemInstanceId: notInPocket.id })
      .then(() => null, (e: unknown) => e)
    expect(refused).toBeInstanceOf(AppError)
    expect((refused as AppError).statusCode).toBe(400)

    await BattleService.submitAction(user.id, battleId, { action: 'use_item', itemInstanceId: inPocket.id })
    const used = await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: inPocket.id } })
    expect(['CONSUMED', 'DELETED']).toContain(used.status)
  })
})
