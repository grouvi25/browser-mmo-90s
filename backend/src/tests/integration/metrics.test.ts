import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { metricsReport, platformOf } from '../../modules/analytics/metrics'
import { moscowDay } from '../../modules/analytics/acquisition'

// Вкладка «Метрика» (18.11): источник, воронка, удержание, платформы.
describe('метрика админки', () => {
  beforeAll(() => testPrisma.$connect())
  beforeEach(() => cleanDatabase())
  afterAll(() => testPrisma.$disconnect())

  it('считает источники, воронку и возврат на следующий день', async () => {
    const now = new Date()
    const twoDaysAgo = new Date(now.getTime() - 2 * 86_400_000)
    const mk = async (o: { utmSource?: string; referrer?: string; ua?: string; registeredAt: Date; returned: boolean; character: boolean }) => {
      const login = uid('m')
      const user = await testPrisma.user.create({ data: {
        login, email: `${login}@test.local`, passwordHash: 'x', registeredAt: o.registeredAt,
        utmSource: o.utmSource ?? null, utmCampaign: o.utmSource ? 'start' : null, firstReferrer: o.referrer ?? null,
        landingPath: '/', lastUserAgent: o.ua ?? null,
      } })
      if (o.character) await testPrisma.character.create({ data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80 } })
      await testPrisma.userActiveDay.create({ data: { userId: user.id, day: new Date(moscowDay(o.registeredAt)) } })
      if (o.returned) await testPrisma.userActiveDay.create({ data: { userId: user.id, day: new Date(moscowDay(now)) } })
    }
    await mk({ utmSource: 'yandex', registeredAt: twoDaysAgo, returned: true, character: true, ua: 'Mozilla/5.0 (Windows NT 10.0) KooperativDesktop/1.0.0' })
    await mk({ utmSource: 'yandex', registeredAt: twoDaysAgo, returned: false, character: true })
    await mk({ referrer: 'vk.com', registeredAt: twoDaysAgo, returned: true, character: false, ua: 'Mozilla/5.0 (iPhone)' })

    const r = await metricsReport(30, now)
    expect(r.totals.registered).toBe(3)
    const yandex = r.sources.find(s => s.source === 'yandex / start')!
    expect(yandex).toMatchObject({ registered: 2, withCharacter: 2 })
    expect(yandex.d1).toMatchObject({ base: 2, returned: 1, pct: 50 })
    expect(r.sources.find(s => s.source === 'ВКонтакте')?.registered).toBe(1)
    expect(r.funnel[0]).toMatchObject({ step: 'Зарегистрировались', count: 3 })
    expect(r.funnel[1]).toMatchObject({ step: 'Создали персонажа', count: 2 })
    expect(r.platforms.find(p => p.label === 'Программа для ПК')?.count).toBe(1)
    expect(r.series.length).toBeGreaterThanOrEqual(30)
    expect(r.series.at(-1)?.active).toBeGreaterThanOrEqual(2)
    expect(r.players).toHaveLength(3)
  })

  it('платформа по последнему входу', () => {
    expect(platformOf('Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit')).toBe('Android-приложение')
    expect(platformOf('Mozilla/5.0 (Linux; Android 14) Mobile Safari')).toBe('Телефон, браузер')
    expect(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140')).toBe('Компьютер, браузер')
    expect(platformOf(null)).toBe('нет данных')
  })
})
