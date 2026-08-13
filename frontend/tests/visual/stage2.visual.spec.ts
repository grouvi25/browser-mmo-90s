import { expect, request as playwrightRequest, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

type Account = { token: string; userId: string; login: string; nickname: string; characterId: string }
let seller: Account
let buyer: Account
let worker: Account
let listingId = ''
let apiContext: APIRequestContext
const API = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:4000'

async function createAccount(request: APIRequestContext, prefix: string): Promise<Account> {
  const suffix = `${Math.random().toString(36).slice(2, 11)}_${Date.now().toString(36).slice(-5)}`
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 14)
  const login = `${cleanPrefix}_${suffix}`.slice(0, 30)
  const password = 'visual_pass_123'
  const registration = await request.post('/api/auth/register', { data: { login, email: `${login}@visual.local`, password } })
  expect(registration.status()).toBe(201)
  const logged = await request.post('/api/auth/login', { data: { login, password } })
  expect(logged.status()).toBe(200)
  const auth = await logged.json() as { token: string; userId: string }
  const nickname = `V_${suffix}`.slice(0, 30)
  const created = await request.post('/api/characters', {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { nickname, archetype: 'WORKER' },
  })
  expect(created.status()).toBe(201)
  const character = await created.json() as { id: string }
  return { token: auth.token, userId: auth.userId, login, nickname, characterId: character.id }
}

async function authPage(page: Page, account: Account) {
  await page.addInitScript(({ token, userId, login }) => {
    localStorage.setItem('mmo_token', token)
    localStorage.setItem('mmo_user', JSON.stringify({ userId, login }))
  }, account)
}

async function visualProof(page: Page, testInfo: TestInfo, name: string) {
  await expect(page.locator('body')).toBeVisible()
  // .viewport — рабочая область большого экрана, .m-view — мобильной оболочки
  await expect(page.locator('.viewport, .m-view, .balance-sandbox').first()).toBeVisible()
  const image = await page.screenshot({ animations: 'disabled' })
  await testInfo.attach(`${name}-${testInfo.project.name}`, { body: image, contentType: 'image/png' })
  const viewport = page.viewportSize()
  if (viewport) {
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(width).toBeLessThanOrEqual(viewport.width + 2)
  }
}

async function buyPrivateItem(request: APIRequestContext, account: Account, code: string) {
  const items = await request.get('/api/private-shops/kommersant/items', { headers: { Authorization: `Bearer ${account.token}` } })
  expect(items.status()).toBe(200)
  const product = (await items.json() as Array<{ id: string; code: string }>).find(item => item.code === code)
  expect(product).toBeTruthy()
  const bought = await request.post('/api/private-shops/kommersant/buy', {
    headers: { Authorization: `Bearer ${account.token}`, 'Idempotency-Key': `visual-buy-${account.login}-${code}` },
    data: { privateShopItemId: product!.id, quantity: 1 },
  })
  expect(bought.status()).toBe(200)
  return (await bought.json() as { itemIds: string[] }).itemIds[0]
}

test.describe.configure({ mode: 'serial' })
test.describe('Stage 2 visual and browser flow', () => {
  test.beforeAll(async ({}, testInfo) => {
    apiContext = await playwrightRequest.newContext({ baseURL: API })
    seller = await createAccount(apiContext, `seller_${testInfo.project.name}`)
    buyer = await createAccount(apiContext, `buyer_${testInfo.project.name}`)
    worker = await createAccount(apiContext, `worker_${testInfo.project.name}`)
    const sellerItem = await buyPrivateItem(apiContext, seller, 'armor_boots_army_private')
    await buyPrivateItem(apiContext, buyer, 'armor_leather_jacket_private')
    const listed = await apiContext.post('/api/market/listings', {
      headers: { Authorization: `Bearer ${seller.token}`, 'Idempotency-Key': `visual-list-${seller.login}` },
      data: { listingType: 'ITEM', itemInstanceId: sellerItem, price: 100 },
    })
    expect(listed.status()).toBe(201)
    listingId = (await listed.json() as { listing: { id: string } }).listing.id
  })

  test.afterAll(async () => { await apiContext?.dispose() })

  test('public login renders without browser errors', async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/login')
    await expect(page.locator('form')).toBeVisible()
    await expect(page.locator('input[type="text"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    const image = await page.screenshot({ animations: 'disabled' })
    await testInfo.attach(`login-${testInfo.project.name}`, { body: image, contentType: 'image/png' })
    expect(errors).toEqual([])
  })

  test('browser registration reaches character creation and creates a playable profile', async ({ page }) => {
    const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
    const login = `browser_${suffix}`.slice(0, 30)
    const password = 'browser_pass_123'
    await page.goto('/register')
    const inputs = page.locator('input')
    await inputs.nth(0).fill(login)
    await inputs.nth(1).fill(`${login}@visual.local`)
    await inputs.nth(2).fill(password)
    await inputs.nth(3).fill(password)
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/character\/create$/)
    await page.locator('input[type="text"]').fill(`Hero_${suffix}`.slice(0, 30))
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.locator('body')).toContainText(`Hero_${suffix}`.slice(0, 30))
  })

  test('expired session redirects instead of rendering empty Stage 2 data', async ({ page }) => {
    await page.goto('/login')
    await page.evaluate(() => {
      localStorage.setItem('mmo_token', 'expired-token')
      localStorage.setItem('mmo_user', JSON.stringify({ userId: 'expired', login: 'expired' }))
    })
    await page.goto('/work')
    await expect(page).toHaveURL(/\/login\?reason=session-expired$/)
    await expect(page.locator('form')).toBeVisible()
  })

  test('E2 work page shows shift controls and six workplaces', async ({ page }, testInfo) => {
    await authPage(page, seller)
    await page.goto('/work')
    await expect(page.getByText('Рабочая смена')).toBeVisible()
    await expect(page.getByText('Объекты города')).toBeVisible()
    await expect(page.locator('tbody tr')).toHaveCount(6)
    await visualProof(page, testInfo, 'e2-work')
  })

  test('work browser flow requires a tool, buys it and starts a shift', async ({ page }, testInfo) => {
    await authPage(page, worker)
    await page.goto('/work')
    await expect(page.getByRole('button', { name: 'Нужен инструмент' }).first()).toBeVisible()

    const shop = await apiContext.get('/api/shops/government/items', { headers: { Authorization: `Bearer ${worker.token}` } })
    expect(shop.status()).toBe(200)
    const tool = (await shop.json() as Array<{ templateId: string; template: { type: string; toolTier: number | null } }>).find(item => item.template.type === 'TOOL' && item.template.toolTier === 1)
    expect(tool).toBeTruthy()
    const purchase = await apiContext.post('/api/shops/government/buy', {
      headers: { Authorization: `Bearer ${worker.token}` }, data: { templateId: tool!.templateId },
    })
    expect(purchase.status()).toBe(201)

    await page.reload()
    const start = page.getByRole('button', { name: 'Выйти' }).first()
    await expect(start).toBeEnabled()
    const startedResponse = page.waitForResponse(response => response.url().includes('/api/work/shifts/start') && response.request().method() === 'POST')
    await start.click()
    expect((await startedResponse).status()).toBe(201)
    const current = await apiContext.get('/api/work/shifts/current', { headers: { Authorization: `Bearer ${worker.token}` } })
    expect(current.status()).toBe(200)
    const currentBody = await current.json() as { shift: { id: string; status: string; toolInstance: unknown } | null }
    expect(currentBody.shift?.status).toBe('ACTIVE')
    expect(currentBody.shift?.toolInstance).toBeTruthy()
    await visualProof(page, testInfo, 'e2-work-tool-shift')

    const shiftId = currentBody.shift!.id
    const cancelled = await apiContext.post(`/api/work/shifts/${shiftId}/cancel`, { headers: { Authorization: `Bearer ${worker.token}` } })
    expect(cancelled.status()).toBe(200)
  })

  test('balance sandbox reacts to inputs and exports a report', async ({ page }, testInfo) => {
    await authPage(page, seller)
    await page.goto('/balance-sandbox')
    await expect(page.locator('.sandbox-results article')).toHaveCount(3)
    const workerBefore = await page.locator('.sandbox-results article').nth(1).innerText()
    await page.locator('input[type="range"]').nth(2).fill('220')
    await expect(page.locator('.sandbox-results article').nth(1)).not.toHaveText(workerBefore)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Скачать JSON' }).click()
    expect((await download).suggestedFilename()).toBe('balance-sandbox.json')
    await visualProof(page, testInfo, 'balance-sandbox')
  })

  test('government weapon shop supports exact level selection and item images', async ({ page }, testInfo) => {
    await authPage(page, seller)
    await page.goto('/shop')
    await page.getByRole('button', { name: 'Оружие', exact: true }).click()
    await page.getByRole('button', { name: 'Ур. 2', exact: true }).click()
    const rows = page.locator('tbody tr')
    await expect(rows).not.toHaveCount(0)
    expect(await rows.locator('img').count()).toBe(await rows.count())
    await visualProof(page, testInfo, 'government-weapons-level-2')
  })

  test('location navigation exposes districts first and contextual rooms second', async ({ page }) => {
    await authPage(page, seller)
    await page.goto('/industrial')
    await expect(page.getByRole('button', { name: 'Промзона', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Работа', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Улучшают шмот', exact: true })).toBeVisible()
    await page.goto('/agriculture')
    await expect(page.getByRole('button', { name: 'Фермы и колхозы', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Растения', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Дело', exact: true })).toHaveCount(0)
  })

  test('E1 resources page shows weight and government inventory state', async ({ page }, testInfo) => {
    await authPage(page, seller)
    await page.goto('/resources')
    await expect(page.getByText('Общий вес:', { exact: false })).toBeVisible()
    await visualProof(page, testInfo, 'e1-resources')
  })

  test('E3 private shops expose tier-2 products and both shops', async ({ page }, testInfo) => {
    await authPage(page, seller)
    await page.goto('/shops/private')
    await expect(page.getByRole('button', { name: 'Коммерсант' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Оружейный гараж' })).toBeVisible()
    // Именно заголовок колонки: слово «Уровень» встречается и в карточке персонажа.
    // Ищем селектором, а не ролью: на узком экране таблица переключается на блочное
    // отображение, и роль columnheader у ячейки пропадает вместе с табличным контекстом.
    await expect(page.locator('.data-table thead th', { hasText: 'Уровень' })).toBeAttached()
    await visualProof(page, testInfo, 'e3-private-shops')
  })

  test('E4 market shows seller profile and buyer can purchase listing', async ({ page }, testInfo) => {
    await authPage(page, buyer)
    await page.goto('/market')
    await expect(page.getByLabel('Поиск по рынку')).toBeVisible()
    await expect(page.getByLabel('Сортировка рынка')).toHaveValue('NEWEST')
    await expect(page.getByRole('link', { name: seller.nickname })).toBeVisible()
    const row = page.locator('tr').filter({ has: page.getByRole('link', { name: seller.nickname }) })
    await expect(row.getByRole('button', { name: 'Купить' })).toBeVisible()
    await visualProof(page, testInfo, 'e4-market')
    const bought = await apiContext.post(`/api/market/listings/${listingId}/buy`, {
      headers: { Authorization: `Bearer ${buyer.token}`, 'Idempotency-Key': `visual-market-buy-${buyer.login}` },
    })
    expect(bought.status()).toBe(200)
  })

  test('E5 upgrades shows preview controls for buyer item', async ({ page }, testInfo) => {
    await authPage(page, buyer)
    await page.goto('/upgrades')
    await expect(page.getByText('Улучшение вещей')).toBeVisible()
    const selector = page.locator('select').first()
    await expect(selector.locator('option')).toHaveCount(3)
    await page.locator('select').nth(1).selectOption('ARMOR')
    await selector.selectOption({ index: 1 })
    await expect(page.getByText('Шанс успеха:', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Улучшить' })).toBeVisible()
    await visualProof(page, testInfo, 'e5-upgrades')
  })

  test('Stage 2 pages meet automated WCAG A/AA checks and expose keyboard focus', async ({ page }, testInfo) => {
    await authPage(page, seller)
    const routes = ['/work', '/resources', '/shops/private', '/market', '/upgrades']

    for (const route of routes) {
      await page.goto(route)
      await expect(page.locator('.viewport, .m-view, .balance-sandbox').first()).toBeVisible()
      await page.keyboard.press('Tab')
      await expect(page.locator(':focus')).not.toHaveCount(0)

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
      await testInfo.attach(`axe-${route.replaceAll('/', '') || 'root'}-${testInfo.project.name}`, {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
      })
      expect(results.violations, `${route} accessibility violations`).toEqual([])
    }
  })

  test('authenticated Stage 2 routes reject no unexpected page errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await authPage(page, seller)
    for (const route of ['/work', '/resources', '/shops/private', '/market', '/upgrades']) {
      await page.goto(route)
      // .viewport — рабочая область большого экрана, .m-view — мобильной оболочки
  await expect(page.locator('.viewport, .m-view, .balance-sandbox').first()).toBeVisible()
    }
    expect(errors).toEqual([])
  })
})

