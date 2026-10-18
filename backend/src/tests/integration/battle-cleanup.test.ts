/**
 * «Я завис в бою» — правка заказчика (16 октября 2026).
 *
 * Бой живёт в Redis. После перезапуска Redis запись в базе оставалась
 * ACTIVE, а клиент уводил игрока на экран боя, где ходить уже нечем.
 * Второй случай — статус IN_BATTLE без самого боя: в бой не пускало,
 * вернуться было некуда.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runBattleCleanup, releaseStuckCharacters, LOST_STATE_GRACE_MS, LEGACY_WAITING_MS } from '../../workers/battle-cleanup.worker'
import { ApplicationsService } from '../../modules/battles/applications.service'
import { BattleService } from '../../modules/battles/battles.service'
import { BattleRedis, disconnectRedis } from '../../shared/db/redis'
import { cleanDatabase, testPrisma, uid } from './helpers'

describe('уборка зависших боёв', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => {
    await testPrisma.$disconnect()
    await disconnectRedis()
  })

  async function fighter(prefix: string) {
    const login = uid(prefix)
    const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
    const character = await testPrisma.character.create({
      data: { userId: user.id, nickname: login, archetype: 'STREET', hpCurrent: 100, hpMax: 100, money: 1_000, battleLevel: 3, status: 'ACTIVE' },
    })
    await testPrisma.characterStats.create({ data: { characterId: character.id } })
    return { user, character }
  }
  const statusOf = async (id: string) =>
    (await testPrisma.character.findUniqueOrThrow({ where: { id }, select: { status: true } })).status

  it('бой без состояния в Redis закрывается, игрок возвращается в город', async () => {
    const a = await fighter('lost')
    const { battleId } = await BattleService.startPve(a.user.id, 'training_bandit')
    expect(await statusOf(a.character.id)).toBe('IN_BATTLE')

    // Свежий бой не трогаем: состояние могло ещё не лечь в Redis.
    await BattleRedis.deleteState(battleId)
    await runBattleCleanup()
    expect((await testPrisma.battle.findUniqueOrThrow({ where: { id: battleId } })).status).toBe('ACTIVE')

    await testPrisma.battle.update({ where: { id: battleId }, data: { startedAt: new Date(Date.now() - LOST_STATE_GRACE_MS - 1000) } })
    await runBattleCleanup()
    const battle = await testPrisma.battle.findUniqueOrThrow({ where: { id: battleId } })
    expect(battle.status).toBe('FINISHED')
    expect(battle.suspicionReason).toBe('state_lost')
    expect(await statusOf(a.character.id)).toBe('ACTIVE')
  })

  it('идущий бой с живым состоянием уборка не трогает', async () => {
    const a = await fighter('live')
    const { battleId } = await BattleService.startPve(a.user.id, 'training_bandit')
    await testPrisma.battle.update({ where: { id: battleId }, data: { startedAt: new Date(Date.now() - LOST_STATE_GRACE_MS - 1000) } })
    await runBattleCleanup()
    expect((await testPrisma.battle.findUniqueOrThrow({ where: { id: battleId } })).status).toBe('ACTIVE')
    expect(await statusOf(a.character.id)).toBe('IN_BATTLE')
    await BattleRedis.deleteState(battleId)
  })

  it('вечная заявка старого образца снимается, и создатель выходит из «боя»', async () => {
    // Так висели test1 и Admin: дуэль создана до заявок с таймером, без
    // startsAt, принять её уже нечем, а создатель числится «в бою».
    const a = await fighter('legacy')
    const battle = await testPrisma.battle.create({
      data: { type: 'PVP_DUEL', status: 'WAITING_PLAYERS', levelMin: 1, levelMax: 99, createdAt: new Date(Date.now() - LEGACY_WAITING_MS - 1000) },
    })
    await testPrisma.battleParticipant.create({ data: { battleId: battle.id, characterId: a.character.id, side: 1, hpMax: 100, hpCurrent: 100 } })
    await testPrisma.character.update({ where: { id: a.character.id }, data: { status: 'IN_BATTLE' } })
    // Свежую такую заявку (так на секунды создаётся бой осады) не трогаем.
    const fresh = await testPrisma.battle.create({ data: { type: 'CLAN', status: 'WAITING_PLAYERS', levelMin: 1, levelMax: 99 } })

    await runBattleCleanup()
    expect((await testPrisma.battle.findUniqueOrThrow({ where: { id: battle.id } })).status).toBe('CANCELLED')
    expect((await testPrisma.battle.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('WAITING_PLAYERS')
    expect(await statusOf(a.character.id)).toBe('ACTIVE')
  })

  it('статус «в бою» без боя снимается и уборкой, и запросом текущего боя', async () => {
    const a = await fighter('stuck-a')
    const b = await fighter('stuck-b')
    await testPrisma.character.updateMany({ where: { id: { in: [a.character.id, b.character.id] } }, data: { status: 'IN_BATTLE' } })

    expect(await releaseStuckCharacters()).toBe(2)
    expect(await statusOf(a.character.id)).toBe('ACTIVE')

    await testPrisma.character.update({ where: { id: b.character.id }, data: { status: 'IN_BATTLE' } })
    expect((await ApplicationsService.current(b.user.id)).battleId).toBeNull()
    expect(await statusOf(b.character.id)).toBe('ACTIVE')
  })
})
