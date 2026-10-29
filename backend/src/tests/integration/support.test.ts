/**
 * Поддержка тикетами (правка 29.10): обращение с темой и категорией,
 * переписка в обе стороны, заметки поддержки, непрочитанное, закрытие,
 * повторное открытие и оценка. Плюс окно при входе в игру.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SUPPORT, SupportService } from '../../modules/support/support.service'
import { SiteService } from '../../modules/site/site.service'
import { disconnectRedis, getRedis } from '../../shared/db/redis'
import { cleanDatabase, testPrisma, uid } from './helpers'

// Картинка 1×1 PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function player(prefix: string) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({
    data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'STREET', hpCurrent: 100, hpMax: 100, status: 'ACTIVE' },
  })
}

const ask = (characterId: string, text = 'Не открывается склад', image?: string) =>
  SupportService.create(characterId, { subject: 'Склад', category: 'BUG', text, image })

describe('Поддержка', () => {
  beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })
  afterAll(async () => { await testPrisma.$disconnect(); await disconnectRedis() })

  it('обращение: номер, тема, первое сообщение со скриншотом; картинка отдаётся байтами', async () => {
    const ch = await player('sup')
    const ticket = await SupportService.create(ch.id, { subject: '  Пропал   склад ', category: 'BUG', text: '  Не открывается  ', image: PNG })
    expect(ticket).toMatchObject({ subject: 'Пропал склад', category: 'BUG', status: 'OPEN', staffUnread: true })
    expect(ticket.number).toBeGreaterThan(0)

    const thread = await SupportService.thread(ch.id, ticket.id)
    expect(thread.messages).toHaveLength(1)
    expect(thread.messages[0]).toMatchObject({ author: 'PLAYER', text: 'Не открывается', hasImage: true })
    expect('imageData' in thread.messages[0]).toBe(false)

    const image = await SupportService.playerImage(ch.id, ticket.id, thread.messages[0].id)
    expect(image?.mime).toBe('image/png')
    expect(image?.bytes.subarray(1, 4).toString()).toBe('PNG')

    // Чужое обращение для другого игрока не существует.
    const other = await player('oth')
    await expect(SupportService.thread(other.id, ticket.id)).rejects.toMatchObject({ statusCode: 404 })
    await expect(SupportService.playerImage(other.id, ticket.id, thread.messages[0].id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('пустая тема или текст, чужой формат и слишком большой скриншот — отказ', async () => {
    const ch = await player('bad')
    await expect(SupportService.create(ch.id, { subject: ' ', text: 'текст' })).rejects.toMatchObject({ statusCode: 422 })
    await expect(ask(ch.id, '   ')).rejects.toMatchObject({ statusCode: 422 })
    await expect(ask(ch.id, 'текст', 'data:image/gif;base64,R0lGOD')).rejects.toMatchObject({ statusCode: 422 })
    const huge = 'data:image/jpeg;base64,' + Buffer.alloc(SUPPORT.imageMaxBytes + 1).toString('base64')
    await expect(ask(ch.id, 'текст', huge)).rejects.toMatchObject({ statusCode: 422 })
  })

  it('ждущих ответа обращений не больше лимита; после ответа можно писать снова', async () => {
    const ch = await player('lim')
    const first = await ask(ch.id, 'раз')
    for (let i = 1; i < SUPPORT.openMax; i++) await ask(ch.id, `ещё ${i}`)
    await expect(ask(ch.id, 'лишнее')).rejects.toMatchObject({ statusCode: 429 })

    await SupportService.adminMessage(first.id, 'support1', { text: 'Починили' })
    await expect(ask(ch.id, 'новое')).resolves.toMatchObject({ status: 'OPEN' })
  })

  it('переписка: ответ поддержки — уведомление и непрочитанное у игрока, ответ игрока — снова ждёт поддержку', async () => {
    const ch = await player('ans')
    const ticket = await ask(ch.id, 'Пропали деньги')

    const staff = await SupportService.adminThread(ticket.id)
    expect(staff.player).toMatchObject({ nickname: ch.nickname })
    expect((await testPrisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } })).staffUnread).toBe(false)

    await SupportService.adminMessage(ticket.id, 'support1', { text: 'Сколько и когда?' })
    const row = await testPrisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } })
    expect(row).toMatchObject({ status: 'ANSWERED', playerUnread: true, assignedTo: 'support1' })
    expect(await SupportService.unread(ch.id)).toEqual({ count: 1 })
    const notice = await testPrisma.gameNotice.findFirstOrThrow({ where: { characterId: ch.id } })
    expect(notice.text).toContain(`№${ticket.number}`)

    // Открыл — прочитал.
    await SupportService.thread(ch.id, ticket.id)
    expect(await SupportService.unread(ch.id)).toEqual({ count: 0 })

    const after = await SupportService.playerMessage(ch.id, ticket.id, { text: '100 рублей, вчера', image: PNG })
    expect(after.ticket.status).toBe('OPEN')
    expect(after.messages.map(m => m.author)).toEqual(['PLAYER', 'STAFF', 'PLAYER'])
    expect(after.messages[1]).toMatchObject({ authorLabel: 'support1', text: 'Сколько и когда?' })
    expect((await testPrisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } })).staffUnread).toBe(true)

    await expect(SupportService.adminMessage(ticket.id, 'support1', { text: '  ' })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('заметка поддержки игроку не видна и статус не меняет', async () => {
    const ch = await player('note')
    const ticket = await ask(ch.id)
    const staff = await SupportService.adminMessage(ticket.id, 'support1', { text: 'Проверить логи склада', internal: true })
    expect(staff.messages.at(-1)).toMatchObject({ internal: true, text: 'Проверить логи склада' })
    expect(staff.ticket.status).toBe('OPEN')

    const mine = await SupportService.thread(ch.id, ticket.id)
    expect(mine.messages.map(m => m.text)).toEqual(['Не открывается склад'])
    expect(await SupportService.unread(ch.id)).toEqual({ count: 0 })
  })

  it('игрок не может засыпать обращение сообщениями без ответа', async () => {
    const ch = await player('spam')
    const ticket = await ask(ch.id)
    for (let i = 1; i < SUPPORT.streakMax; i++) await SupportService.playerMessage(ch.id, ticket.id, { text: `ещё ${i}` })
    await expect(SupportService.playerMessage(ch.id, ticket.id, { text: 'лишнее' })).rejects.toMatchObject({ statusCode: 429 })
  })

  it('закрытие, оценка и повторное открытие своим сообщением', async () => {
    const ch = await player('cls')
    const ticket = await ask(ch.id)
    await expect(SupportService.rate(ch.id, ticket.id, 5)).rejects.toMatchObject({ statusCode: 409 })

    await SupportService.adminMessage(ticket.id, 'support1', { text: 'Починили', close: true })
    const closed = await SupportService.thread(ch.id, ticket.id)
    expect(closed.ticket).toMatchObject({ status: 'CLOSED', closedBy: 'support1', canReopen: true })
    expect(closed.messages.at(-1)).toMatchObject({ author: 'SYSTEM' })

    const rated = await SupportService.rate(ch.id, ticket.id, 4)
    expect(rated.ticket.rating).toBe(4)
    await expect(SupportService.rate(ch.id, ticket.id, 6)).rejects.toMatchObject({ statusCode: 422 })

    const reopened = await SupportService.playerMessage(ch.id, ticket.id, { text: 'Опять сломалось' })
    expect(reopened.ticket).toMatchObject({ status: 'OPEN', rating: null, closedAt: null })

    // Давно закрытое открыть нельзя — только новое обращение.
    await SupportService.playerClose(ch.id, ticket.id)
    await testPrisma.supportTicket.update({ where: { id: ticket.id }, data: { closedAt: new Date(Date.now() - (SUPPORT.reopenDays + 1) * 86_400_000) } })
    await expect(SupportService.playerMessage(ch.id, ticket.id, { text: 'ещё' })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('очередь поддержки: счётчики, фильтры, поиск по номеру и нику, «мои»', async () => {
    const a = await player('qa')
    const b = await player('qb')
    const t1 = await ask(a.id, 'раз')
    const t2 = await SupportService.create(b.id, { subject: 'Оплата не дошла', category: 'PAYMENT', text: 'два' })
    await SupportService.adminMessage(t1.id, 'support1', { text: 'ответ' })
    // Непрочитанное у поддержки — новое от игрока, которое ещё никто не открывал.
    expect((await SupportService.adminList({}, 'support1')).unread).toBe(1)
    await SupportService.adminUpdate(t2.id, 'support2', { priority: 'HIGH', assign: 'me' })

    const all = await SupportService.adminList({}, 'support1')
    expect(all.counts).toEqual({ OPEN: 1, ANSWERED: 1, CLOSED: 0 })
    expect(all.unread).toBe(0)

    expect((await SupportService.adminList({ status: 'OPEN' }, 'x')).items.map(r => r.id)).toEqual([t2.id])
    expect((await SupportService.adminList({ category: 'PAYMENT' }, 'x')).items.map(r => r.id)).toEqual([t2.id])
    expect((await SupportService.adminList({ q: `#${t1.number}` }, 'x')).items.map(r => r.id)).toEqual([t1.id])
    expect((await SupportService.adminList({ q: b.nickname.slice(0, 6) }, 'x')).items.map(r => r.id)).toEqual([t2.id])
    expect((await SupportService.adminList({ assigned: 'me' }, 'support2')).items.map(r => r.id)).toEqual([t2.id])
    expect((await SupportService.adminList({ assigned: 'none' }, 'x')).items).toHaveLength(0)

    const closed = await SupportService.adminUpdate(t2.id, 'support2', { status: 'CLOSED' })
    expect(closed.ticket).toMatchObject({ status: 'CLOSED', closedBy: 'support2', priority: 'HIGH', assignedTo: 'support2' })
    expect(await SupportService.unread(b.id)).toEqual({ count: 1 })
  })
})

describe('Окно при входе', () => {
  beforeAll(async () => { await testPrisma.$connect() })
  beforeEach(async () => { await cleanDatabase() })
  afterAll(async () => { await testPrisma.$disconnect() })

  it('нет записи — окна нет; правка текста поднимает версию, выключение — нет', async () => {
    expect(await SiteService.welcome()).toBeNull()
    const first = await SiteService.saveWelcome({ enabled: true, title: 'Тест', text: 'Идёт тестирование' }, 'admin')
    expect(first.version).toBe(1)
    const same = await SiteService.saveWelcome({ enabled: false, title: 'Тест', text: 'Идёт тестирование' }, 'admin')
    expect(same).toMatchObject({ enabled: false, version: 1 })
    const edited = await SiteService.saveWelcome({ enabled: true, title: 'Тест', text: 'Новый текст' }, 'admin')
    expect(edited.version).toBe(2)
    await expect(SiteService.saveWelcome({ enabled: true, title: '', text: 'x' }, 'admin')).rejects.toMatchObject({ statusCode: 422 })
  })
})
