/**
 * Поддержка (правка заказчика 21.10.2026): обращение со скриншотом, лимит
 * открытых обращений, ответ из админки уведомлением игроку.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SUPPORT, SupportService } from '../../modules/support/support.service'
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

describe('Поддержка', () => {
  beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })
  afterAll(async () => { await testPrisma.$disconnect(); await disconnectRedis() })

  it('обращение со скриншотом сохраняется, картинка отдаётся байтами', async () => {
    const ch = await player('sup')
    const ticket = await SupportService.create(ch.id, '  Не открывается склад  ', PNG)
    expect(ticket).toMatchObject({ text: 'Не открывается склад', status: 'OPEN', hasImage: true })
    expect('imageData' in ticket).toBe(false)

    const image = await SupportService.image(ticket.id)
    expect(image?.mime).toBe('image/png')
    expect(image?.bytes.subarray(1, 4).toString()).toBe('PNG')

    const mine = await SupportService.mine(ch.id)
    expect(mine.items.map(row => row.id)).toEqual([ticket.id])
  })

  it('пустой текст, чужой формат и слишком большой скриншот — отказ', async () => {
    const ch = await player('bad')
    await expect(SupportService.create(ch.id, '   ')).rejects.toMatchObject({ statusCode: 422 })
    await expect(SupportService.create(ch.id, 'текст', 'data:image/gif;base64,R0lGOD')).rejects.toMatchObject({ statusCode: 422 })
    const huge = 'data:image/jpeg;base64,' + Buffer.alloc(SUPPORT.imageMaxBytes + 1).toString('base64')
    await expect(SupportService.create(ch.id, 'текст', huge)).rejects.toMatchObject({ statusCode: 422 })
  })

  it('открытых обращений не больше лимита; после ответа можно писать снова', async () => {
    const ch = await player('lim')
    const first = await SupportService.create(ch.id, 'раз')
    for (let i = 1; i < SUPPORT.openMax; i++) await SupportService.create(ch.id, `ещё ${i}`)
    await expect(SupportService.create(ch.id, 'лишнее')).rejects.toMatchObject({ statusCode: 429 })

    await SupportService.reply(first.id, 'support1', 'Починили')
    await expect(SupportService.create(ch.id, 'новое')).resolves.toMatchObject({ status: 'OPEN' })
  })

  it('ответ из админки: статус, автор и уведомление игроку', async () => {
    const ch = await player('ans')
    const ticket = await SupportService.create(ch.id, 'Пропали деньги')
    const answered = await SupportService.reply(ticket.id, 'support1', 'Вернули 100 ₽')
    expect(answered).toMatchObject({ status: 'ANSWERED', reply: 'Вернули 100 ₽' })

    const row = await testPrisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } })
    expect(row.repliedBy).toBe('support1')
    const open = await SupportService.adminList('OPEN')
    expect(open.items).toHaveLength(0)
    const all = await SupportService.adminList()
    expect(all.items[0]).toMatchObject({ id: ticket.id, character: { nickname: ch.nickname } })

    await expect(SupportService.reply(ticket.id, 'support1', '  ')).rejects.toMatchObject({ statusCode: 422 })
    expect((await SupportService.close(ticket.id)).status).toBe('CLOSED')
  })
})
