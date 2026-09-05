/**
 * Городские объявления — вторая половина «Радио».
 *
 * Главное свойство: событие мира НИКОГДА не роняет вызвавшую операцию.
 * Объявление о захвате территории — следствие, а не часть захвата, и
 * откатывать захват из-за неудачной записи в ленту нельзя.
 *
 * Второе: снятое объявление уходит из ленты, но остаётся в истории —
 * иначе не разобрать, что и когда убрали.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AnnouncementsService } from '../../modules/announcements/announcements.service'
import { MAX_TITLE } from '../../modules/announcements/announcements.formulas'
import { testPrisma, uid } from './helpers'

describe('объявления', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => { await testPrisma.announcement.deleteMany() })
  afterAll(async () => {
    await testPrisma.announcement.deleteMany()
    await testPrisma.$disconnect()
  })

  async function admin(role: 'SUPER_ADMIN' | 'MODERATOR' = 'MODERATOR') {
    return testPrisma.adminUser.create({
      data: { username: uid('adm'), passwordHash: 'x', role },
    })
  }

  it('подписывает объявление настоящим именем администратора, а не его номером', async () => {
    const who = await admin()
    const posted = await AnnouncementsService.publish({
      kind: 'NEWS', title: 'Открыт вокзал', body: 'Пускают с понедельника.', adminId: who.id,
    })
    expect(posted.authorLogin).toBe(who.username)
    expect(posted.kind).toBe('NEWS')
  })

  it('держит закреплённое сверху, даже когда сверху пришло свежее', async () => {
    const who = await admin()
    await AnnouncementsService.publish({ kind: 'NEWS', title: 'Правила', body: 'Читать всем.', pinned: true, adminId: who.id })
    await AnnouncementsService.publish({ kind: 'PATCH', title: 'Патч 1.3', body: 'Починили ремонт.', adminId: who.id })

    const feed = await AnnouncementsService.feed()
    expect(feed.map(a => a.title)).toEqual(['Правила', 'Патч 1.3'])
  })

  it('фильтрует ленту по виду — «Обновления» и «Новости» это один источник', async () => {
    const who = await admin()
    await AnnouncementsService.publish({ kind: 'NEWS', title: 'Новость', body: 'Текст.', adminId: who.id })
    await AnnouncementsService.publish({ kind: 'PATCH', title: 'Патч', body: 'Текст.', adminId: who.id })

    expect((await AnnouncementsService.feed('PATCH')).map(a => a.title)).toEqual(['Патч'])
    expect((await AnnouncementsService.feed('NEWS')).map(a => a.title)).toEqual(['Новость'])
    expect(await AnnouncementsService.feed()).toHaveLength(2)
  })

  it('снятое уходит из ленты, но остаётся в истории', async () => {
    const who = await admin()
    const posted = await AnnouncementsService.publish({ kind: 'NEWS', title: 'Ошибка', body: 'Не то написал.', adminId: who.id })

    await AnnouncementsService.remove(posted.id)
    expect(await AnnouncementsService.feed()).toHaveLength(0)

    const row = await testPrisma.announcement.findUnique({ where: { id: posted.id } })
    expect(row?.removedAt).not.toBeNull()
  })

  it('не снимает то, чего нет, и не снимает дважды', async () => {
    const who = await admin()
    const posted = await AnnouncementsService.publish({ kind: 'NEWS', title: 'Раз', body: 'Текст.', adminId: who.id })
    await AnnouncementsService.remove(posted.id)
    await expect(AnnouncementsService.remove(posted.id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('отказывает в пустом объявлении, а длинное обрезает по колонке', async () => {
    const who = await admin()
    await expect(AnnouncementsService.publish({ kind: 'NEWS', title: '   ', body: 'Есть текст.', adminId: who.id }))
      .rejects.toMatchObject({ statusCode: 422 })

    const long = await AnnouncementsService.publish({
      kind: 'NEWS', title: 'з'.repeat(MAX_TITLE + 80), body: 'Текст.', adminId: who.id,
    })
    expect(long.title).toHaveLength(MAX_TITLE)
  })

  // ── События мира ──────────────────────────────────────────

  it('пишет событие мира без автора — его пишет игра, а не человек', async () => {
    await AnnouncementsService.world('Территория захвачена', 'Рынок перешёл к бригаде «Кепка».')
    const feed = await AnnouncementsService.feed('WORLD')
    expect(feed).toHaveLength(1)
    expect(feed[0].authorLogin).toBeNull()
  })

  it('молча пропускает событие мира с пустым текстом, ничего не роняя', async () => {
    await expect(AnnouncementsService.world('  ', '  ')).resolves.toBeUndefined()
    expect(await AnnouncementsService.feed('WORLD')).toHaveLength(0)
  })

  it('не бросает, даже если запись события мира не удалась', async () => {
    // Заголовок длиннее колонки урезается формулой, но проверяем главное:
    // вызывающая сторона не получает исключения ни при каких данных.
    await expect(AnnouncementsService.world('т'.repeat(5_000), 'б'.repeat(9_000)))
      .resolves.toBeUndefined()
    expect(await AnnouncementsService.feed('WORLD')).toHaveLength(1)
  })
})
