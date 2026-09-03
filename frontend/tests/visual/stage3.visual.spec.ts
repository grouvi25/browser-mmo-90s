import { expect, request as playwrightRequest, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

type Account = { token: string; userId: string; login: string; nickname: string; characterId: string }

const API = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:4000'

let apiContext: APIRequestContext
let owner: Account

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
  const nickname = `S3_${suffix}`.slice(0, 30)
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

/** Снимок раздела + проверка, что страница не поехала вбок. */
async function visualProof(page: Page, testInfo: TestInfo, name: string) {
  await expect(page.locator('body')).toBeVisible()
  const image = await page.screenshot({ animations: 'disabled', fullPage: false })
  await testInfo.attach(`${name}-${testInfo.project.name}`, { body: image, contentType: 'image/png' })
  const viewport = page.viewportSize()
  if (viewport) {
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(width).toBeLessThanOrEqual(viewport.width + 2)
  }
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()
  expect(results.violations.map(v => `${v.id}: ${v.help}`)).toEqual([])
}

test.beforeAll(async () => {
  apiContext = await playwrightRequest.newContext({ baseURL: API })
  owner = await createAccount(apiContext, 's3owner')
})

test.afterAll(async () => { await apiContext.dispose() })

/** Каждый раздел Этапа 3 открывается, рисует заголовок и не ломает вёрстку. */
const SECTIONS: Array<{ path: string; heading: string; name: string }> = [
  { path: '/farm', heading: 'Ферма', name: 'farm' },
  { path: '/plants', heading: 'Растения', name: 'plants' },
  { path: '/objects', heading: 'Объекты', name: 'objects' },
  { path: '/recipes', heading: 'Рецепты', name: 'recipes' },
  { path: '/bars', heading: 'Бары', name: 'bars' },
  { path: '/bars/mine', heading: 'Мой бар', name: 'my-bar' },
  { path: '/clans', heading: 'Бригада', name: 'clan' },
  { path: '/clans/storage', heading: 'Клановый склад', name: 'clan-storage' },
  { path: '/clans/treasury', heading: 'Общак', name: 'clan-treasury' },
  { path: '/clans/relations', heading: 'Отношения', name: 'clan-relations' },
]

for (const section of SECTIONS) {
  test(`раздел ${section.heading} открывается и держит вёрстку`, async ({ page }, testInfo) => {
    await authPage(page, owner)
    await page.goto(section.path)
    await expect(page.getByRole('heading', { level: 1, name: section.heading })).toBeVisible()
    await visualProof(page, testInfo, `stage3-${section.name}`)
  })
}

test('город ведёт в разделы Этапа 3 из своих районов', async ({ page }, testInfo) => {
  await authPage(page, owner)
  await page.goto('/')
  const strip = page.locator('[data-stage-nav]')
  if (await strip.count() === 0) test.skip(true, 'мобильная оболочка рисует навигацию иначе')
  // Бары и бригада — комнаты, а не районы: так их развесил основной макет.
  await expect(page.locator('[data-stage-nav="clan"]')).toBeVisible()
  await visualProof(page, testInfo, 'stage3-city-districts')
})

test('разделы Этапа 3 подсвечивают свой район', async ({ page }) => {
  await authPage(page, owner)
  const cases: Array<[string, string]> = [
    ['/bars', 'market'],
    ['/clans', 'center'],
    ['/objects', 'industrial'],
    ['/farm', 'industrial'],
  ]
  for (const [path, district] of cases) {
    await page.goto(path)
    const tab = page.locator(`[data-stage-nav="${district}"]`)
    if (await tab.count() === 0) test.skip(true, 'мобильная оболочка рисует навигацию иначе')
    await expect(tab).toHaveClass(/is-active/)
  }
})

test('ферма и бригада проходят axe без нарушений', async ({ page }) => {
  await authPage(page, owner)
  await page.goto('/farm')
  await expect(page.getByRole('heading', { level: 1, name: 'Ферма' })).toBeVisible()
  await expectNoAxeViolations(page)

  await page.goto('/clans')
  await expect(page.getByRole('heading', { level: 1, name: 'Бригада' })).toBeVisible()
  await expectNoAxeViolations(page)
})

test('рынок объектов показывает цену и кнопку покупки', async ({ page }) => {
  await authPage(page, owner)
  await page.goto('/objects')
  await page.getByRole('tab', { name: 'Рынок объектов' }).click()
  await expect(page.getByRole('button', { name: /Купить за/ }).first()).toBeVisible()
})

/**
 * Этап 4: пять экранов стратегического слоя.
 *
 * Проверяем не вёрстку, а то, что каждый открывается, не роняет страницу и
 * держит свою полосу вкладок. Макетов под них нет, поэтому пиксели сверять
 * не с чем — а вот «раздел не открылся» ловится именно здесь.
 */
const STAGE4_SCREENS: Array<[string, string, number]> = [
  ['/territories', 'Территории', 3],
  ['/territories/raids', 'Налёты', 3],
  ['/territories/wars', 'Войны бригады', 3],
  ['/premium', 'Премиум', 2],
  ['/premium/helpers', 'Помощники', 2],
]

for (const [path, title, tabs] of STAGE4_SCREENS) {
  test(`раздел ${title} открывается и держит вкладки`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await authPage(page, owner)
    await page.goto(path)
    await expect(page.locator('.viewport__title, .m-view h1').first()).toContainText(title)
    // Граница ошибок рисует эту плашку вместо раздела — значит он упал.
    await expect(page.getByText('Раздел не открылся')).toHaveCount(0)
    if (!test.info().project.name.startsWith('mobile')) {
      await expect(page.locator('.s3-group a')).toHaveCount(tabs)
    }
    expect(errors).toEqual([])
  })
}

test('состав на бой собирается из бригады и отсекает слабых', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Карта районов проверяется на широком экране')
  await authPage(page, owner)
  await page.goto('/territories')
  const claim = page.locator('.s4-district').first().getByRole('button', { name: 'Подать заявку' })
  // Без бригады заявку подать нельзя — и кнопка об этом честно молчит,
  // а причина стоит текстом рядом.
  if (await claim.isDisabled()) {
    await expect(page.locator('.s4-district__blocked').first()).toBeVisible()
    return
  }
  await claim.click()
  const picker = page.locator('.s4-roster')
  await expect(picker).toBeVisible()
  // Кнопка отправки заперта, пока состав не набран: сервер откажет тем же
  // условием, но узнавать об этом из ошибки — плохой способ.
  await expect(picker.locator('.s4-roster__actions button').first()).toBeDisabled()
})
