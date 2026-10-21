import { describe, expect, it } from 'vitest'
import { uid } from '../integration/helpers'

const BASE = process.env.E2E_API_URL ?? 'http://127.0.0.1:4400'

async function api(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, data: await res.json().catch(() => null) as any }
}

describe('E2E: уведомления в чате по действиям', () => {
  it('посадка на ферме оставляет личную строку «Системы», чужой игрок её не видит', async () => {
    const login = uid('notice')
    await api('POST', '/api/auth/register', { acceptPolicy: true, login, email: `${login}@e2e.local`, password: 'pass1234' })
    const token = (await api('POST', '/api/auth/login', { login, password: 'pass1234' })).data.token as string
    await api('POST', '/api/characters', { nickname: uid('Hero'), archetype: 'WORKER' }, token)

    const farm = await api('GET', '/api/farm', undefined, token)
    const plotId = farm.data.plots[0].id as string
    expect((await api('POST', `/api/farm/plots/${plotId}/plant`, { cropCode: 'dill' }, token)).status).toBe(201)
    expect((await api('POST', `/api/farm/plots/${plotId}/water`, undefined, token)).status).toBe(200)

    // Запись идёт после ответа: даём ей мгновение.
    let items: Array<{ text: string }> = []
    for (let i = 0; i < 20 && items.length < 2; i++) {
      await new Promise(r => setTimeout(r, 150))
      items = (await api('GET', '/api/chat/notices', undefined, token)).data.items
    }
    expect(items.map(n => n.text)).toEqual(['Вы посадили: Укроп.', 'Вы полили грядку.'])

    // Отказ уведомления не оставляет: вторая посадка на занятый участок.
    expect((await api('POST', `/api/farm/plots/${plotId}/plant`, { cropCode: 'dill' }, token)).status).toBe(409)
    await new Promise(r => setTimeout(r, 400))
    expect((await api('GET', '/api/chat/notices', undefined, token)).data.items).toHaveLength(2)

    const other = uid('other')
    await api('POST', '/api/auth/register', { acceptPolicy: true, login: other, email: `${other}@e2e.local`, password: 'pass1234' })
    const otherToken = (await api('POST', '/api/auth/login', { login: other, password: 'pass1234' })).data.token as string
    await api('POST', '/api/characters', { nickname: uid('Hero'), archetype: 'WORKER' }, otherToken)
    expect((await api('GET', '/api/chat/notices', undefined, otherToken)).data.items).toEqual([])
  })
})
