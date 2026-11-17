import { describe, expect, it } from 'vitest'
import { attributionFields, moscowDay, referrerHost, sourceLabel } from '../../modules/analytics/acquisition'

describe('откуда пришёл игрок', () => {
  it('сайт-источник хранится только доменом, без www и пути', () => {
    expect(referrerHost('https://www.Yandex.ru/search/?text=игра+90-е')).toBe('yandex.ru')
    expect(referrerHost('t.me')).toBe('t.me')
    expect(referrerHost('не адрес вовсе')).toBeNull()
    expect(referrerHost('')).toBeNull()
  })

  it('метки обрезаются, мусор и пустые строки отбрасываются', () => {
    const f = attributionFields({ utmSource: '  yandex_direct ', utmCampaign: 'x'.repeat(500), utmTerm: '   ', landing: '/register?utm_source=a', referrer: 'https://vk.com/wall-1' })
    expect(f.utmSource).toBe('yandex_direct')
    expect(f.utmCampaign).toHaveLength(120)
    expect(f.utmTerm).toBeNull()
    expect(f.landingPath).toBe('/register')
    expect(f.firstReferrer).toBe('vk.com')
    expect(attributionFields({ landing: 'https://evil.example/' }).landingPath).toBeNull()
    expect(attributionFields(undefined)).toEqual({})
  })

  it('понятные имена источников', () => {
    expect(sourceLabel({ utmSource: 'yandex_direct', utmCampaign: 'start', firstReferrer: 'yandex.ru' })).toBe('yandex_direct / start')
    expect(sourceLabel({ utmSource: null, firstReferrer: 'yandex.ru' })).toBe('Яндекс')
    expect(sourceLabel({ utmSource: null, firstReferrer: 'm.vk.com' })).toBe('ВКонтакте')
    expect(sourceLabel({ utmSource: null, firstReferrer: 't.me' })).toBe('Telegram')
    expect(sourceLabel({ utmSource: null, firstReferrer: 'forum.example.org' })).toBe('forum.example.org')
    expect(sourceLabel({ utmSource: null, firstReferrer: null })).toBe('прямой заход')
  })

  it('день считается по Москве', () => {
    expect(moscowDay(new Date('2026-11-17T20:59:00Z'))).toBe('2026-11-17')
    expect(moscowDay(new Date('2026-11-17T21:01:00Z'))).toBe('2026-11-18')
  })
})
