// Админский токен для e2e — один на весь прогон.
//
// Локации гейтятся по боевому уровню (обещание игрокам 22.10), а тесты
// ходят по всем, поэтому тестовым персонажам досыпают опыт админ-роутом.
// Раньше каждый тест логинился админом сам: на ПК и телефоне это десяток
// входов в минуту, а вход в админку ограничен пятью — прогон падал на 429.
// Лимит правильный, поэтому входим один раз в globalSetup.
import { expect, request, type APIRequestContext } from '@playwright/test'

const API = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:4000'

export default async function globalSetup() {
  const ctx = await request.newContext()
  const login = await ctx.post(`${API}/api/admin/auth/login`, {
    data: { username: 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'admin_change_me_now' },
  })
  if (login.status() !== 200) throw new Error(`Вход в админку для e2e: ${login.status()}`)
  process.env.E2E_ADMIN_TOKEN = (await login.json() as { token: string }).token
  await ctx.dispose()
}

/** Досыпать персонажу боевого опыта, чтобы открылись все локации. */
export async function unlockLocations(req: APIRequestContext, characterId: string) {
  const token = process.env.E2E_ADMIN_TOKEN
  expect(token, 'globalSetup не выдал админский токен').toBeTruthy()
  const grant = await req.post(`${API}/api/admin/characters/exp`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { characterId, track: 'battle', amount: 50_000_000, reason: 'e2e: открыть локации по уровню' },
  })
  expect(grant.status()).toBe(200)
}
