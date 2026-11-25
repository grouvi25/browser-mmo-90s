import { expect, test, type Page } from '@playwright/test'

// Обучение по образцу RomeWar (Дима 25.11): одна подсказка — одно действие,
// подсказка у нужной кнопки, остальное затемнено и не нажимается.
async function press(page: Page, target: ReturnType<Page['locator']>, isMobile: boolean) {
  await expect(target).toBeVisible()
  if (isMobile) await target.tap()
  else await target.click()
}

test('новичок проходит обучение по подсказкам у кнопок и получает письмо', async ({ page, request, isMobile }) => {
  const login = 'guide_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const password = 'visual_pass_123'
  const register = await request.post('/api/auth/register', {
    data: { login, password, email: login + '@visual.local', acceptPolicy: true, acceptPd: true },
  })
  expect(register.status()).toBe(201)
  const session = await request.post('/api/auth/login', { data: { login, password } })
  expect(session.status()).toBe(200)
  const { token, userId } = await session.json() as { token: string; userId: string }
  await page.addInitScript(({ token, userId, login }) => {
    localStorage.setItem('mmo_token', token)
    localStorage.setItem('mmo_user', JSON.stringify({ userId, login }))
  }, { token, userId, login })

  await page.goto('/character/create')
  await page.getByRole('button', { name: /Студент/ }).click()
  await page.getByRole('button', { name: 'Создать персонажа' }).click()
  await expect(page).toHaveURL(/\/$/)
  const letter = page.getByRole('dialog', { name: /Кодекс выживания/ })
  const hint = page.locator('.tour__bubble')
  const intro = page.getByRole('dialog', { name: 'Первые шаги' })
  await expect(intro).toBeVisible()
  await expect(letter).toHaveCount(0)
  await intro.getByRole('button', { name: 'Начать' }).click()

  // Купить: кнопка Гос магазина на площади подсвечена, остальное закрыто шторками.
  await expect(hint).toContainText('Открой Гос магазин.')
  await expect(page.locator('.tour__shade')).toHaveCount(4)
  await expect(page.locator('.tour__ring')).toBeVisible()
  await press(page, page.locator('[data-stage-nav="shop"]'), isMobile)
  const buy = page.locator('[data-tutorial-focus="buy"]')
  await expect(hint).toContainText('Нажми «Купить»')
  await expect(page.locator('.gshop-card').filter({ has: buy })).toContainText('7–15,75 HP')
  await press(page, buy, isMobile)

  // Надеть: из магазина назад на площадь, потом Склад.
  await expect(hint).toContainText('Надень оружие')
  await expect(hint).toContainText('Вернись на площадь')
  await press(page, page.locator('[data-stage-nav="center"]'), isMobile)
  await expect(hint).toContainText('Открой Склад.')
  await press(page, page.locator('[data-stage-nav="inventory"]'), isMobile)
  await expect(hint).toContainText('Нажми «Надеть»')
  await press(page, page.locator('[data-tutorial-focus="equip"]'), isMobile)

  // Вложить очко: Настроить → Макс. урон → Сохранить, подсказка внутри окна.
  await expect(hint).toContainText('Нажми «Настроить»')
  await press(page, page.locator('[data-tutorial-focus="setup"]'), isMobile)
  const settings = page.locator('.inv-setup')
  await expect(settings.locator('.tour__bubble')).toContainText('Впиши 1 в «Макс. урон».')
  await settings.locator('[data-tutorial-focus="max-damage"]').fill('1')
  await expect(settings.locator('.tour__bubble')).toContainText('Нажми «Сохранить».')
  await press(page, settings.locator('[data-tutorial-focus="save"]'), isMobile)

  // Характеристики: площадь → Центр подготовки → «+» → «Подтвердить».
  await expect(hint).toContainText('Характеристики')
  await press(page, page.locator('[data-stage-nav="center"]'), isMobile)
  await press(page, page.locator('[data-stage-nav="skills"]'), isMobile)
  await expect(hint).toContainText('Нажми «+» у Силы.')
  await press(page, page.locator('[data-tutorial-focus="stat-plus"]'), isMobile)
  const savedStats = page.waitForResponse(response => response.url().endsWith('/api/characters/stats/apply')
    && response.request().method() === 'POST')
  await press(page, page.locator('[data-tutorial-focus="stat-confirm"]'), isMobile)
  expect((await savedStats).ok()).toBe(true)
  await expect(letter).toHaveCount(0)
  await page.getByRole('dialog', { name: 'Готово' }).getByRole('button', { name: 'Завершить обучение' }).click()
  await expect(letter).toBeVisible()
  await expect(letter).toContainText(login)
  await letter.getByRole('button', { name: 'Понял, Бывалый' }).click()
  await expect(letter).toHaveCount(0)
  await page.reload()
  await expect(hint).toHaveCount(0)
  await expect(letter).toHaveCount(0)
})

test('«×» скрывает подсказки до конца сеанса, Библиотека возвращает их', async ({ page, request }) => {
  const login = 'pause_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const password = 'visual_pass_123'
  expect((await request.post('/api/auth/register', {
    data: { login, password, email: login + '@visual.local', acceptPolicy: true, acceptPd: true },
  })).status()).toBe(201)
  const { token, userId } = await (await request.post('/api/auth/login', { data: { login, password } })).json() as { token: string; userId: string }
  expect((await request.post('/api/characters', { headers: { Authorization: `Bearer ${token}` }, data: { archetype: 'STUDENT' } })).status()).toBe(201)
  await page.addInitScript(({ token, userId, login }) => {
    localStorage.setItem('mmo_token', token)
    localStorage.setItem('mmo_user', JSON.stringify({ userId, login }))
    sessionStorage.setItem('mmo_resumed', '1')
  }, { token, userId, login })

  await page.goto('/')
  const intro = page.getByRole('dialog', { name: 'Первые шаги' })
  await intro.getByRole('button', { name: 'Начать' }).click()
  const hint = page.locator('.tour__bubble')
  await expect(hint).toContainText('Открой Гос магазин.')
  await hint.getByRole('button', { name: 'Скрыть подсказки' }).click()
  await expect(hint).toHaveCount(0)
  await page.reload()
  await expect(hint).toHaveCount(0)
  await page.goto('/training')
  await page.getByRole('link', { name: 'Продолжить на площади' }).click()
  await expect(hint).toContainText('Открой Гос магазин.')
})
