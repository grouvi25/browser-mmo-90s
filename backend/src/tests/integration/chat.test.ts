/**
 * Эфир — чат «радио».
 *
 * Главное свойство, которое проверяется: комнату НЕЛЬЗЯ выбрать
 * запросом. Район берётся из закрытого списка, клан — из членства.
 * Иначе достаточно подделать одно поле, чтобы читать и писать в чужой
 * клан, а это худшее, что может случиться с закрытым каналом.
 *
 * Второе: антифлуд отказывает молча и возвращает причину, а не роняет
 * запрос ошибкой. Слишком частая реплика — обычный ход разговора.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ChatService } from '../../modules/chat/chat.service'
import { FLOOD, MAX_BODY, floodKeys } from '../../modules/chat/chat.formulas'
import { getRedis, disconnectRedis } from '../../shared/db/redis'
import { cleanDatabase, testPrisma, uid } from './helpers'

describe('эфир', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => {
    await cleanDatabase()
    // Гасим только общий ключ присутствия: всё остальное в Redis
    // привязано к идентификатору персонажа, а он в каждом тесте свой.
    // Полный flushdb снёс бы состояние соседних наборов тестов —
    // они идут одним процессом.
    await getRedis().del('chat:online')
  })
  afterAll(async () => {
    await testPrisma.$disconnect()
    await disconnectRedis()
  })

  async function player(prefix: string) {
    const login = uid(prefix)
    const user = await testPrisma.user.create({
      data: { login, email: `${login}@test.local`, passwordHash: 'x' },
    })
    const character = await testPrisma.character.create({
      data: {
        userId: user.id, nickname: login, archetype: 'WORKER',
        hpCurrent: 80, hpMax: 80, money: 1_000, battleLevel: 5,
      },
    })
    return { user, character, login }
  }

  /** Клан с одной ролью и одним участником — минимум, чтобы был канал. */
  async function clanWith(characterId: string, name: string) {
    const clan = await testPrisma.clan.create({ data: { name: uid(name), tag: uid('tag') } })
    const role = await testPrisma.clanRole.create({
      data: { clanId: clan.id, code: 'LEADER', name: 'Главный', rank: 1, permissions: {} },
    })
    await testPrisma.clanMember.create({
      data: { clanId: clan.id, characterId, roleId: role.id, status: 'ACTIVE' },
    })
    return clan
  }

  /** Между репликами нужна пауза: иначе в них упирается сам тест. */
  async function clearGap(characterId: string) {
    await getRedis().del(floodKeys.last(characterId), floodKeys.repeat(characterId))
  }

  // ── Общий канал ───────────────────────────────────────────

  it('принимает реплику в общий канал и отдаёт её в ленте', async () => {
    const { user, character } = await player('chat-g')
    const who = await ChatService.speaker(user.id)

    const sent = await ChatService.send(who, 'GLOBAL', undefined, '  Ну что, собрались?  ')
    expect(sent.ok).toBe(true)
    if (!sent.ok) return
    // Крайние пробелы срезаются: в ленту попадает то, что увидят.
    expect(sent.line.body).toBe('Ну что, собрались?')
    expect(sent.line.nickname).toBe(character.nickname)

    const feed = await ChatService.history('GLOBAL', '')
    expect(feed.map(m => m.body)).toEqual(['Ну что, собрались?'])
  })

  it('не отдаёт в ленте спрятанную модератором реплику', async () => {
    const { user } = await player('chat-hide')
    const who = await ChatService.speaker(user.id)
    const sent = await ChatService.send(who, 'GLOBAL', undefined, 'то, что придётся убрать')
    expect(sent.ok).toBe(true)
    if (!sent.ok) return

    await ChatService.hide(sent.line.id, user.id)
    expect(await ChatService.history('GLOBAL', '')).toHaveLength(0)

    // След остаётся: по пустому месту жалобу не разобрать.
    const row = await testPrisma.chatMessage.findUnique({ where: { id: sent.line.id } })
    expect(row?.deletedAt).not.toBeNull()
    expect(row?.deletedBy).toBe(user.id)
  })

  // ── Районы ────────────────────────────────────────────────

  it('держит районы порознь и отказывает в выдуманном', async () => {
    const { user } = await player('chat-d')
    const who = await ChatService.speaker(user.id)

    const sent = await ChatService.send(who, 'DISTRICT', 'market', 'почём нынче металлолом')
    expect(sent.ok).toBe(true)

    expect(await ChatService.history('DISTRICT', 'market')).toHaveLength(1)
    // Соседний район той же реплики не слышит.
    expect(await ChatService.history('DISTRICT', 'center')).toHaveLength(0)

    await clearGap(who.characterId)
    await expect(ChatService.send(who, 'DISTRICT', 'подпольный', 'эй'))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  // ── Клан ──────────────────────────────────────────────────

  it('не пускает в клановый канал того, кто не в клане', async () => {
    const { user } = await player('chat-noclan')
    const who = await ChatService.speaker(user.id)
    await expect(ChatService.send(who, 'CLAN', undefined, 'свои?'))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('пишет в СВОЙ клан, даже если в запросе указан чужой', async () => {
    const mine = await player('chat-mine')
    const other = await player('chat-other')
    const myClan = await clanWith(mine.character.id, 'ourclan')
    const alienClan = await clanWith(other.character.id, 'alienclan')

    const who = await ChatService.speaker(mine.user.id)
    // Подделка: в поле комнаты — чужой клан.
    const sent = await ChatService.send(who, 'CLAN', alienClan.id, 'сбор в девять')
    expect(sent.ok).toBe(true)
    if (!sent.ok) return
    expect(sent.line.scope).toBe(myClan.id)

    expect(await ChatService.history('CLAN', myClan.id)).toHaveLength(1)
    // В чужом клане реплика не появилась.
    expect(await ChatService.history('CLAN', alienClan.id)).toHaveLength(0)
  })

  it('отбирает канал у исключённого из клана', async () => {
    const { user, character } = await player('chat-left')
    const clan = await clanWith(character.id, 'exclan')
    expect((await ChatService.speaker(user.id)).clanId).toBe(clan.id)

    await testPrisma.clanMember.updateMany({
      where: { characterId: character.id },
      data: { status: 'LEFT', leftAt: new Date() },
    })
    expect((await ChatService.speaker(user.id)).clanId).toBeNull()
  })

  // ── Модерация и антифлуд ──────────────────────────────────

  it('молчащему в рот воды не даёт сказать', async () => {
    const { user } = await player('chat-mute')
    await testPrisma.user.update({
      where: { id: user.id },
      data: { mutedUntil: new Date(Date.now() + 3_600_000) },
    })
    const who = await ChatService.speaker(user.id)
    await expect(ChatService.send(who, 'GLOBAL', undefined, 'а я всё равно скажу'))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('снятый мут больше не мешает', async () => {
    const { user } = await player('chat-unmute')
    await testPrisma.user.update({
      where: { id: user.id },
      data: { mutedUntil: new Date(Date.now() - 1_000) },
    })
    const who = await ChatService.speaker(user.id)
    expect((await ChatService.send(who, 'GLOBAL', undefined, 'отсидел')).ok).toBe(true)
  })

  it('отклоняет пустую реплику и слишком длинную, не бросая ошибку', async () => {
    const { user } = await player('chat-len')
    const who = await ChatService.speaker(user.id)

    const empty = await ChatService.send(who, 'GLOBAL', undefined, '   \n\n  ')
    expect(empty).toMatchObject({ ok: false, reason: { kind: 'empty' } })

    const long = await ChatService.send(who, 'GLOBAL', undefined, 'я'.repeat(MAX_BODY + 1))
    expect(long).toMatchObject({ ok: false, reason: { kind: 'too-long', max: MAX_BODY } })

    // Ни одна из них до базы не дошла.
    expect(await ChatService.history('GLOBAL', '')).toHaveLength(0)
  })

  it('держит паузу между репликами', async () => {
    const { user } = await player('chat-fast')
    const who = await ChatService.speaker(user.id)

    expect((await ChatService.send(who, 'GLOBAL', undefined, 'раз')).ok).toBe(true)
    const second = await ChatService.send(who, 'GLOBAL', undefined, 'два')
    expect(second).toMatchObject({ ok: false, reason: { kind: 'too-fast' } })

    // Пауза выдержана — реплика проходит.
    const later = new Date(Date.now() + FLOOD.minGapMs + 50)
    expect((await ChatService.send(who, 'GLOBAL', undefined, 'два', later)).ok).toBe(true)
    expect(await ChatService.history('GLOBAL', '')).toHaveLength(2)
  })

  it('не пропускает одну и ту же реплику дважды подряд', async () => {
    const { user } = await player('chat-repeat')
    const who = await ChatService.speaker(user.id)

    expect((await ChatService.send(who, 'GLOBAL', undefined, 'КУПЛЮ ПАТРОНЫ')).ok).toBe(true)
    const again = await ChatService.send(
      who, 'GLOBAL', undefined, 'куплю патроны',
      new Date(Date.now() + FLOOD.minGapMs + 50),
    )
    // Регистр повтору не помеха.
    expect(again).toMatchObject({ ok: false, reason: { kind: 'repeat' } })
  })

  it('закрывает окно после лимита реплик в минуту', async () => {
    const { user } = await player('chat-window')
    const who = await ChatService.speaker(user.id)

    let at = Date.now()
    for (let i = 0; i < FLOOD.windowLimit; i++) {
      at += FLOOD.minGapMs + 50
      const sent = await ChatService.send(who, 'GLOBAL', undefined, `реплика ${i}`, new Date(at))
      expect(sent.ok).toBe(true)
    }

    at += FLOOD.minGapMs + 50
    const overflow = await ChatService.send(who, 'GLOBAL', undefined, 'ещё одна', new Date(at))
    expect(overflow).toMatchObject({
      ok: false,
      reason: { kind: 'too-many', limit: FLOOD.windowLimit },
    })
  })

  // ── Присутствие ───────────────────────────────────────────

  it('показывает в эфире тех, кто отметился, и убирает ушедших', async () => {
    const one = await player('chat-on1')
    const two = await player('chat-on2')

    await ChatService.touch(one.character.id)
    await ChatService.touch(two.character.id)
    const online = await ChatService.online()
    expect(online.map(p => p.characterId).sort()).toEqual([one.character.id, two.character.id].sort())
    expect(online.find(p => p.characterId === one.character.id)?.nickname).toBe(one.character.nickname)

    await ChatService.leave(one.character.id)
    expect((await ChatService.online()).map(p => p.characterId)).toEqual([two.character.id])
  })
})
