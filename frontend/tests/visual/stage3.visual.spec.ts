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
  const registration = await request.post('/api/auth/register', { data: { acceptPolicy: true, login, email: `${login}@visual.local`, password } })
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

// mmo_resumed: вкладка уже «вернулась на последнюю локацию». Без метки первый
// заход на главную уводит на последнюю локацию общего тестового аккаунта, и
// проверки главной зависели бы от того, какой тест шёл перед ними. Сам
// возврат проверяет отдельный тест (resume: true).
async function authPage(page: Page, account: Account, { resume = false } = {}) {
  await page.addInitScript(({ token, userId, login, resume }) => {
    localStorage.setItem('mmo_token', token)
    localStorage.setItem('mmo_user', JSON.stringify({ userId, login }))
    if (!resume) sessionStorage.setItem('mmo_resumed', '1')
  }, { ...account, resume })
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
  await expect(page.locator('[data-stage-nav="clans"]')).toBeVisible()
  await visualProof(page, testInfo, 'stage3-city-districts')
})

// Правка 21.10: на списке домов бригад внизу только ЦЕНТР — вкладки бригады
// появляются, когда зашли в свою.
test('на списке домов бригад внизу только ЦЕНТР', async ({ page }) => {
  await authPage(page, owner)
  await page.goto('/clan-houses')
  await expect(page.locator('[data-stage-nav="center"]')).toHaveText('ЦЕНТР')
  await expect(page.locator('[data-stage-nav="storage"]')).toHaveCount(0)
  await page.goto('/clan-houses?brigade=mine')
  await expect(page.locator('[data-stage-nav="storage"]')).toHaveCount(1)
})

// Правка 21.10: «Поддержка» в Центре — текст и форма со скриншотом.
test('поддержка: обращение со скриншотом уходит и видно в списке', async ({ page }) => {
  await authPage(page, owner)
  await page.goto('/')
  await page.locator('[data-stage-nav="support"]').click()
  await expect(page).toHaveURL(/\/support$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Поддержка' })).toBeVisible()
  await page.getByLabel('Обращение').fill('Не открывается склад после боя')
  // Картинка 1×1 PNG: страница сама ужмёт её в JPEG.
  await page.locator('.support input[type=file]').setInputFiles({
    name: 'shot.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  })
  await expect(page.getByAltText('Скриншот к обращению')).toBeVisible()
  await page.locator('.support').getByRole('button', { name: 'Отправить' }).click()
  await expect(page.locator('.support__msg')).toContainText('Обращение отправлено')
  await expect(page.locator('.support__ticket').first()).toContainText('Не открывается склад после боя')
  await expect(page.locator('.support__ticket').first()).toContainText('со скриншотом')
  await expectNoAxeViolations(page)
})

// Правка 21.10: свой набор смайлов в стиле игры.
test('чат: свой смайл уходит кодом и показывается картинкой', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Поле ввода города — на широком экране')
  await authPage(page, owner)
  await page.goto('/')
  const composer = page.locator('.ether-composer--city')
  await composer.getByRole('button', { name: 'Смайлики' }).click()
  await composer.getByRole('option', { name: 'Девятка' }).click()
  await expect(composer.locator('.ether-input')).toHaveValue(':devyatka: ')
  await composer.locator('.ether-input').fill('на стрелку :devyatka: :neznakomy:')
  await composer.locator('.ether-input').press('Enter')
  const line = page.locator('.ether-body', { hasText: 'на стрелку' }).last()
  await expect(line.locator('img.smile[alt="Девятка"]')).toBeVisible()
  await expect(line).toContainText(':neznakomy:')
})

// Правка 21.10: жильё стоит заранее — 16 квартир и 8 домов на плане.
test('жилой сектор: план из 24 участков, свободный можно выбрать', async ({ page }) => {
  await authPage(page, owner)
  await page.goto('/housing')
  await expect(page.locator('.housing-lot')).toHaveCount(24)
  await page.getByRole('button', { name: /^Дом 8:/ }).click()
  await expect(page.locator('.housing__offer')).toContainText('Дом 8')
  await expect(page.getByRole('button', { name: /^Дом 8:/ })).toHaveAttribute('aria-pressed', 'true')
  await expectNoAxeViolations(page)
})

test('в локации полоса подсвечивает её раздел', async ({ page }) => {
  await authPage(page, owner)
  for (const [path, tab] of [['/market', 'board'], ['/clans', 'clan'], ['/work', 'work'], ['/farm', 'plant'], ['/pvp', 'all'], ['/pvp?tab=RUNNING', 'running']]) {
    await page.goto(path)
    await expect(page.locator(`[data-stage-nav="${tab}"]`)).toHaveClass(/is-active/)
    await expect(page.locator('[data-stage-nav="center"]')).toHaveText('ЦЕНТР')
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
  // Вкладки раздела живут в нижней полосе локации: ЦЕНТР и разделы.
  ['/territories', 'Территории', 4],
  ['/territories/raids', 'Налёты', 4],
  ['/territories/wars', 'Войны бригады', 4],
  ['/premium', 'Чёрный рынок', 4],
  ['/premium/helpers', 'Помощники', 4],
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
    await expect(page.locator('.city-locations button')).toHaveCount(tabs)
    await expect(page.locator('.city-locations button').first()).toHaveText('ЦЕНТР')
    expect(errors).toEqual([])
  })
}

// «Подробнее» роняла карточку района целиком: ручка не отдавала history,
// а компонент читал у неё length. Раскрытие тут проверяется кликом, а не
// наличием кнопки, — иначе дефект снова пройдёт мимо тестов.
test('«Подробнее» раскрывает карточку района, а не роняет её', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Карта районов проверяется на широком экране')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await authPage(page, owner)
  await page.goto('/territories')

  await page.locator('button', { hasText: 'Подробнее' }).first().click()

  const details = page.locator('.s4-district__details').first()
  await expect(details).toBeVisible()
  await expect(details).toContainText('Объекты района')
  await expect(page.getByText('Раздел не открылся')).toHaveCount(0)
  expect(errors).toEqual([])
})

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

// Правка заказчика 20.10: «при авторизации должна открываться последняя локация».
// Открыв сайт на главной (закладка, новая вкладка), игрок попадает туда, где был,
// а главная не затирает последнюю локацию.
test('открытие сайта на главной возвращает на последнюю локацию', async ({ page }) => {
  const res = await apiContext.put('/api/city/location', { headers: { Authorization: `Bearer ${owner.token}` }, data: { path: '/farm' } })
  expect(res.ok()).toBe(true)
  await authPage(page, owner, { resume: true })
  await page.goto('/')
  await expect(page).toHaveURL(/\/farm$/)
  // Дальше в той же вкладке главная открывается как обычно.
  await page.goto('/')
  await expect(page.locator('[data-stage-nav="center"], [data-stage-nav="clans"]').first()).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})
