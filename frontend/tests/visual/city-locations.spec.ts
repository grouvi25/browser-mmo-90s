import { expect, test, type APIRequestContext } from '@playwright/test'
import { CITY_LOCATIONS } from '../../src/shared/lib/city-locations'
const API = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:4000'

// Локации гейтятся по боевому уровню (обещание игрокам 22.10), а тест
// обходит их все. Опыт выдаёт админ-роут — досыпаем столько, чтобы
// хватило до последнего уровня при любой кривой порогов.
async function unlockLocations(request: APIRequestContext, characterId: string) {
  const login = await request.post(`${API}/api/admin/auth/login`, { data: { username: 'admin', password: 'admin_change_me_now' } })
  expect(login.status()).toBe(200)
  const { token } = await login.json() as { token: string }
  const grant = await request.post(`${API}/api/admin/characters/exp`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { characterId, track: 'battle', amount: 50_000_000, reason: 'e2e: открыть локации по уровню' },
  })
  expect(grant.status()).toBe(200)
}

test('city locations, return controls, readable fonts and resume after login', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000)
  const login = `cityui_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const password = 'city_test_password_984'
  expect((await request.post(`${API}/api/auth/register`, { data: { acceptPolicy: true, login, email: `${login}@test.local`, password } })).status()).toBe(201)
  const auth = await (await request.post(`${API}/api/auth/login`, { data: { login, password } })).json()
  const created = await request.post(`${API}/api/characters`, { headers: { Authorization: `Bearer ${auth.token}` }, data: { nickname: login, archetype: 'WORKER' } })
  expect(created.status()).toBe(201)
  await unlockLocations(request, ((await created.json()) as { id: string }).id)
  await page.goto('/login')
  await page.getByPlaceholder('Ваш логин').fill(login); await page.getByPlaceholder('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти в игру' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('navigation', { name: 'Локации Центра' })).toBeVisible()
  await expect(page.locator('.top-nav')).toHaveCount(0)
  // В Центре внизу — локации; в локации — ЦЕНТР первой кнопкой и её
  // разделы, а локаций Центра там уже нет (переходы только через Центр).
  for (const location of CITY_LOCATIONS.filter(item => item.key !== 'center')) {
    const button = page.locator(`[data-stage-nav="${location.key}"]`)
    await button.scrollIntoViewIfNeeded(); await button.click()
    await expect.poll(() => new URL(page.url()).pathname).toBe(location.to)
    const center = page.locator('.city-locations button').first()
    await expect(center).toHaveText('ЦЕНТР')
    await expect(page.getByRole('navigation', { name: 'Локации Центра' })).toHaveCount(0)
    // «← ЦЕНТР» сверху справа убран (правка 21.10): в город — только нижней кнопкой.
    await expect(page.locator('.viewport__back')).toHaveCount(0)
    await expect(center).toBeVisible(); await center.click()
    await expect(page).toHaveURL(/\/$/)
  }
  await page.locator('[data-stage-nav="school"]').click()
  await expect(page.getByRole('heading', { name: 'Училище', exact: true })).toBeVisible()
  expect(await page.locator('.city-locations button').first().evaluate(el => getComputedStyle(el).fontFamily)).toContain('Arial')
  const currentToken = await page.evaluate(() => localStorage.getItem('mmo_token'))
  await expect.poll(async () => (await (await request.get(`${API}/api/city/location`, { headers: { Authorization: `Bearer ${currentToken}` } })).json()).path).toBe('/school')
  await testInfo.attach(`city-${testInfo.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 2)
  await page.evaluate(() => localStorage.clear()); await page.goto('/login')
  await page.getByPlaceholder('Ваш логин').fill(login); await page.getByPlaceholder('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти в игру' }).click()
  await expect(page).toHaveURL(/\/school$/)
})
