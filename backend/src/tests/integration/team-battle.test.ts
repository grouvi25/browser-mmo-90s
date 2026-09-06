/**
 * Массовые бои — то, что заказчик просил проверить.
 *
 * Код лобби существовал с Этапа 4, но целиком, от сбора до победы, его
 * ни разу не прогоняли. Здесь проходится весь путь: создание, вход
 * второй стороны, старт, ходы, завершение и — главное — возврат бойцов
 * в обычный статус. Последнее уже ломалось однажды на территориях:
 * участники оставались IN_BATTLE навсегда, потому что живое состояние
 * никто не строил.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BattleService } from '../../modules/battles/battles.service'
import { BattleRedis } from '../../shared/db/redis'
import { disconnectRedis } from '../../shared/db/redis'
import { cleanDatabase, testPrisma, uid } from './helpers'

describe('массовые бои', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => {
    await testPrisma.$disconnect()
    await disconnectRedis()
  })

  /** Боец одного уровня со всеми: лобби пускает в коридоре ±5. */
  async function fighter(prefix: string) {
    const login = uid(prefix)
    const user = await testPrisma.user.create({
      data: { login, email: `${login}@test.local`, passwordHash: 'x' },
    })
    const character = await testPrisma.character.create({
      data: {
        userId: user.id, nickname: login, archetype: 'STREET',
        hpCurrent: 100, hpMax: 100, money: 1_000, battleLevel: 10,
        status: 'ACTIVE',
      },
    })
    // Значения по умолчанию в схеме уже боевые — хватает связи с героем.
    await testPrisma.characterStats.create({ data: { characterId: character.id } })
    return { user, character }
  }

  const statusOf = async (id: string) =>
    (await testPrisma.character.findUnique({ where: { id }, select: { status: true } }))?.status

  it('собирает лобби два на два, стартует и раздаёт всем места на поле', async () => {
    const a1 = await fighter('t-a1')
    const a2 = await fighter('t-a2')
    const b1 = await fighter('t-b1')
    const b2 = await fighter('t-b2')

    const made = await BattleService.createTeamBattle(a1.user.id, 2)
    expect(made).toMatchObject({ status: 'WAITING_PLAYERS', perSide: 2, side: 1 })
    // Создатель сразу занят боем — иначе он успеет уйти в другой.
    expect(await statusOf(a1.character.id)).toBe('IN_BATTLE')

    // Лобби видно в списке открытых.
    const open = await BattleService.listTeamBattles()
    expect(open.items.map(l => l.battleId)).toContain(made.battleId)

    await BattleService.joinTeamBattle(a2.user.id, made.battleId, 1)
    await BattleService.joinTeamBattle(b1.user.id, made.battleId, 2)
    const last = await BattleService.joinTeamBattle(b2.user.id, made.battleId, 2)
    expect(last).toMatchObject({ joined: 4, perSide: 2 })

    const started = await BattleService.startTeamBattle(a1.user.id, made.battleId)
    expect(started).toBeTruthy()

    // Живое состояние построено: четверо на поле, у каждого своя клетка.
    // Форма живого состояния описана здесь, а не выведена: в Redis
    // лежит просто объект, и тест обязан сказать, чего от него ждёт.
    const live = await BattleRedis.getState<{
      participants: { side: number; isAlive: boolean; position: { x: number; y: number } }[]
    }>(made.battleId)
    expect(live).not.toBeNull()
    expect(live!.participants).toHaveLength(4)
    expect(live!.participants.every(p => p.isAlive)).toBe(true)
    const cells = live!.participants.map(p => `${p.position.x}:${p.position.y}`)
    expect(new Set(cells).size).toBe(4)
    // Стороны стоят друг напротив друга, а не вперемешку.
    const xOne = live!.participants.filter(p => p.side === 1).map(p => p.position.x)
    const xTwo = live!.participants.filter(p => p.side === 2).map(p => p.position.x)
    expect(Math.max(...xOne)).toBeLessThan(Math.min(...xTwo))
  })

  it('не пускает в набранную сторону и в чужой бой дважды', async () => {
    const a1 = await fighter('t-full-a')
    const b1 = await fighter('t-full-b')
    const late = await fighter('t-full-c')

    const made = await BattleService.createTeamBattle(a1.user.id, 1)
    await BattleService.joinTeamBattle(b1.user.id, made.battleId, 2)

    // Обе стороны по одному — мест нет.
    await expect(BattleService.joinTeamBattle(late.user.id, made.battleId, 1))
      .rejects.toMatchObject({ statusCode: 409 })
    await expect(BattleService.joinTeamBattle(late.user.id, made.battleId, 2))
      .rejects.toMatchObject({ statusCode: 409 })
    // Опоздавший остался свободен и может пойти в другой бой.
    expect(await statusOf(late.character.id)).toBe('ACTIVE')
  })

  it('не стартует, пока вторая сторона пуста', async () => {
    const a1 = await fighter('t-alone')
    const made = await BattleService.createTeamBattle(a1.user.id, 2)
    await expect(BattleService.startTeamBattle(a1.user.id, made.battleId))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('не даёт стартовать тому, кто в бою не участвует', async () => {
    const a1 = await fighter('t-out-a')
    const b1 = await fighter('t-out-b')
    const stranger = await fighter('t-out-x')

    const made = await BattleService.createTeamBattle(a1.user.id, 1)
    await BattleService.joinTeamBattle(b1.user.id, made.battleId, 2)
    await expect(BattleService.startTeamBattle(stranger.user.id, made.battleId))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('доводит бой один на один до конца и возвращает обоих из боя', async () => {
    const a1 = await fighter('t-fin-a')
    const b1 = await fighter('t-fin-b')

    const made = await BattleService.createTeamBattle(a1.user.id, 1)
    await BattleService.joinTeamBattle(b1.user.id, made.battleId, 2)
    await BattleService.startTeamBattle(a1.user.id, made.battleId)

    // Сдача — самый короткий путь к завершению, и он же проверяет, что
    // бой умеет заканчиваться и разбирать за собой состояние.
    await BattleService.submitAction(b1.user.id, made.battleId, { action: 'surrender' })

    const battle = await testPrisma.battle.findUnique({
      where: { id: made.battleId },
      select: { status: true, winnerId: true },
    })
    expect(battle?.status).toBe('FINISHED')

    // Оба вышли из боя: это ровно то, что ломалось на территориях.
    expect(await statusOf(a1.character.id)).not.toBe('IN_BATTLE')
    expect(await statusOf(b1.character.id)).not.toBe('IN_BATTLE')
  })

  it('не открывает лобби тому, кто уже дерётся', async () => {
    const a1 = await fighter('t-busy-a')
    const b1 = await fighter('t-busy-b')
    const made = await BattleService.createTeamBattle(a1.user.id, 2)
    await BattleService.joinTeamBattle(b1.user.id, made.battleId, 2)

    await expect(BattleService.createTeamBattle(a1.user.id, 2))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})
