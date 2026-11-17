import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, testPrisma } from './helpers'
import { AnnouncementsService } from '../../modules/announcements/announcements.service'

// Черновики (18.11): текст готовят заранее, в ленту он попадает только после публикации.
describe('черновики объявлений', () => {
  beforeAll(() => testPrisma.$connect())
  beforeEach(() => cleanDatabase())
  afterAll(() => testPrisma.$disconnect())

  it('черновик не виден в ленте, правится и публикуется со свежим временем и подписью', async () => {
    const draft = await AnnouncementsService.saveDraft({ kind: 'PATCH', title: 'Обновление от 18.11.2026', body: 'Крафт: 40 очков', authorLabel: 'Claude' })
    expect((await AnnouncementsService.feed()).map(item => item.id)).not.toContain(draft.id)
    expect((await AnnouncementsService.drafts()).map(item => item.id)).toContain(draft.id)

    const edited = await AnnouncementsService.saveDraft({ id: draft.id, kind: 'PATCH', title: draft.title, body: 'Крафт: 40 очков, ап +20' })
    expect(edited.body).toBe('Крафт: 40 очков, ап +20')

    const published = await AnnouncementsService.publishDraft(draft.id, 'Admin')
    expect(published.authorLogin).toBe('Admin')
    expect(published.createdAt.getTime()).toBeGreaterThanOrEqual(draft.createdAt.getTime())
    expect((await AnnouncementsService.feed()).map(item => item.id)).toContain(draft.id)
    expect(await AnnouncementsService.drafts()).toHaveLength(0)
    await expect(AnnouncementsService.publishDraft(draft.id, 'Admin')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('длинное сводное обновление влезает целиком (до 4000 знаков)', async () => {
    const body = 'строка обновления\n'.repeat(180).trim()
    expect(body.length).toBeGreaterThan(3000)
    const draft = await AnnouncementsService.saveDraft({ kind: 'PATCH', title: 'Длинное', body })
    expect(draft.body).toBe(body)
  })
})
