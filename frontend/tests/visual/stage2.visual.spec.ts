import { expect, request as playwrightRequest, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'
import { unlockLocations } from './admin-session'
import AxeBuilder from '@axe-core/playwright'
import { DESIGNER_BATTLE_COLUMNS, DESIGNER_BATTLE_ROWS } from '../../src/shared/lib/designer-battle-grid'
import { MENU } from '../../src/shared/lib/layout-map'

type Account = { token: string; userId: string; login: string; nickname: string; characterId: string }
let seller: Account
let buyer: Account
let worker: Account
let fighter: Account
let listingId = ''
let apiContext: APIRequestContext
const API = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:4000'

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
  const nickname = `V_${suffix}`.slice(0, 30)
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
    fighter = await createAccount(apiContext, `fighter_${testInfo.project.name}`)
    for (const account of [seller, buyer, worker, fighter]) await unlockLocations(apiContext, account.characterId)
    await buyPrivateItem(apiContext, buyer, 'armor_leather_jacket_private')
    // На общий рынок — только ресурсы (правка заказчика 21.10): продавец
    // покупает ремкомплект у Коммерсанта и выставляет его.
    const shopItems = await apiContext.get('/api/private-shops/kommersant/items', { headers: { Authorization: `Bearer ${seller.token}` } })
    const kit = (await shopItems.json() as Array<{ id: string; code: string; resourceTemplateId: string | null }>).find(item => item.code === 'comp_repair_kit')!
    const boughtKit = await apiContext.post('/api/private-shops/kommersant/buy', {
      headers: { Authorization: `Bearer ${seller.token}`, 'Idempotency-Key': `visual-kit-${seller.login}` },
      data: { privateShopItemId: kit.id, quantity: 1 },
    })
    expect(boughtKit.status()).toBe(200)
    const listed = await apiContext.post('/api/market/listings', {
      headers: { Authorization: `Bearer ${seller.token}`, 'Idempotency-Key': `visual-list-${seller.login}` },
      data: { listingType: 'RESOURCE', resourceTemplateId: kit.resourceTemplateId, amount: 1, price: 100 },
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
    // Без согласия с политикой регистрация не проходит (правка 21.10).
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('.alert-error')).toContainText('согласие с политикой')
    await page.getByRole('checkbox').check()
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/character\/create$/)
    await expect(page.locator('.arch-card')).toHaveCount(8)
    await page.locator('.arch-card').nth(1).click()
    await expect(page.locator('.arch-card').nth(1)).toHaveAttribute('aria-pressed', 'true')
    await page.locator('input[type="text"]').fill(`Hero_${suffix}`.slice(0, 30))
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.locator('body')).toContainText(`Hero_${suffix}`.slice(0, 30))
  })

  test('политика открывается без входа и ведёт обратно к регистрации', async ({ page }) => {
    await page.goto('/politika')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Политика в отношении обработки персональных данных')
    await expect(page.locator('.politika h2')).toHaveCount(12)
    await expect(page.locator('body')).toContainText('info@kooperativ.space')
    await page.getByRole('link', { name: '← К регистрации' }).click()
    await expect(page).toHaveURL(/\/register$/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 2)
  })

  test('registration without a character always lands back on onboarding', async ({ page }) => {
    // Учётка есть, персонажа нет — так бывает, если человек ушёл с шага
    // создания: закрыл вкладку, обновил страницу, вернулся по старой
    // ссылке. Раньше он попадал в город без имени, денег и инвентаря,
    // потому что все личные ручки отвечают CHAR_001.
    const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
    const login = `nochar_${suffix}`.slice(0, 30)
    const password = 'visual_pass_123'
    const registration = await apiContext.post('/api/auth/register', {
      data: { acceptPolicy: true, login, email: `${login}@visual.local`, password },
    })
    expect(registration.status()).toBe(201)
    const logged = await apiContext.post('/api/auth/login', { data: { login, password } })
    expect(logged.status()).toBe(200)
    const auth = await logged.json() as { token: string; userId: string }

    await page.goto('/login')
    await page.evaluate(({ token, userId, login }) => {
      localStorage.setItem('mmo_token', token)
      localStorage.setItem('mmo_user', JSON.stringify({ userId, login }))
    }, { token: auth.token, userId: auth.userId, login })

    // Проверяем не только главную: попасть в город можно по любому адресу.
    for (const route of ['/', '/profile', '/shop', '/district/market', '/inventory']) {
      await page.goto(route)
      await expect(page, `${route} должен уводить на создание персонажа`).toHaveURL(/\/character\/create$/)
    }
    await expect(page.locator('.arch-card')).toHaveCount(8)

    // А после онбординга гард пропускает и больше не вмешивается.
    await page.locator('.arch-card').nth(0).click()
    await page.locator('input[type="text"]').fill(`Guard_${suffix}`.slice(0, 30))
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/profile$/)
    await page.goto('/shop')
    await expect(page).toHaveURL(/\/shop$/)
  })

  // Правка 22.10: обувь была куплена, а на складе её не было ни в одной вкладке.
  test('купленная обувь лежит на складе во вкладке «Обувь»', async ({ page }) => {
    await buyPrivateItem(apiContext, fighter, 'armor_boots_army_private')
    await authPage(page, fighter)
    await page.goto('/inventory')
    await page.getByRole('button', { name: 'Обувь', exact: true }).click()
    await expect(page.getByText('Армейские берцы').first()).toBeVisible()
  })

  // Документ заказчика: «после боя — полный лог и кнопка для перехода на
  // локацию, с которой игрок в бой зашёл».
  test('после боя: журнал и кнопка «Вернуться» на локацию, откуда пришли', async ({ page }) => {
    await authPage(page, worker)
    await page.goto('/pvp')
    await expect(page.locator('[data-stage-nav="center"]')).toBeVisible()
    // Локация сохраняется на сервере — ждём, пока /pvp запишется последней.
    await expect.poll(async () => (await (await page.request.get(`${API}/api/city/location`, { headers: { Authorization: `Bearer ${worker.token}` } })).json() as { path: string }).path).toBe('/pvp')
    const started = await apiContext.post('/api/battles/pve/start', {
      headers: { Authorization: `Bearer ${worker.token}` }, data: { botCode: 'training_bandit' },
    })
    expect(started.status()).toBe(201)
    const battleId = (await started.json() as { battleId: string }).battleId
    await page.goto(`/battle/${battleId}`)
    await apiContext.post(`/api/battles/${battleId}/action`, {
      headers: { Authorization: `Bearer ${worker.token}` }, data: { action: 'surrender' },
    })
    const back = page.getByRole('button', { name: 'Вернуться: Стрелки' })
    await expect(back).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Журнал боя')).toBeVisible()
    await back.click()
    await expect(page).toHaveURL(/\/pvp$/)
  })

  // Вопрос заказчика 22.10 «откуда такая посещаемость»: счётчик Метрики
  // грузился и на тестовой сборке, и каждый прогон автотестов шёл в визиты.
  test('автотесты и чужие адреса не шлют визиты в Яндекс.Метрику', async ({ page }) => {
    const hits: string[] = []
    page.on('request', request => { if (request.url().includes('mc.yandex.ru')) hits.push(request.url()) })
    await page.goto('/login')
    await page.waitForLoadState('networkidle')
    expect(hits).toEqual([])
  })

  // Обещание игрокам 23.10: боты для кача выше 4-го уровня. Список ботов на
  // Стрелках собирается из базы, а бой с каждым новым ботом стартует.
  test('на Стрелках боты из базы, включая новых 6–15 уровня', async ({ page }) => {
    const listed = await apiContext.get('/api/battles/bots', { headers: { Authorization: `Bearer ${seller.token}` } })
    expect(listed.status()).toBe(200)
    const bots = (await listed.json() as { items: Array<{ code: string; battleLevel: number }> }).items
    expect(bots.map(b => b.battleLevel)).toEqual([...bots.map(b => b.battleLevel)].sort((a, b) => a - b))
    expect(bots.map(b => b.code)).toEqual(expect.arrayContaining(['training_bandit', 'bratok', 'boevik', 'avtoritet', 'smotryashchiy']))
    for (const code of ['bratok', 'boevik', 'avtoritet', 'smotryashchiy']) {
      const started = await apiContext.post('/api/battles/pve/start', { headers: { Authorization: `Bearer ${seller.token}` }, data: { botCode: code } })
      expect(started.status(), code).toBe(201)
      const { battleId } = await started.json() as { battleId: string }
      await apiContext.post(`/api/battles/${battleId}/action`, { headers: { Authorization: `Bearer ${seller.token}` }, data: { action: 'surrender' } })
    }
    await authPage(page, seller)
    await page.goto('/pvp')
    await page.getByRole('button', { name: 'Бой с ботом' }).click()
    await expect(page.locator('.arena-bot')).toHaveCount(bots.length)
    await expect(page.locator('.arena-bot', { hasText: 'Смотрящий' })).toContainText('ур. 15')
  })

  // Правка 26.10 (образец — «Апеха»): вкладки карточки показывают
  // характеристики с оберегами и личное дело с опытом и поражениями.
  test('карточка персонажа: вкладки «Характеристики» и «Личное дело»', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Карточка со вкладками — на широком экране')
    await authPage(page, seller)
    await page.goto('/')
    await page.getByTitle('Характеристики', { exact: true }).first().click()
    const list = page.locator('.card-list').first()
    await expect(list).toContainText('Сила')
    await expect(list).toContainText('Меткость')
    await expect(list).toContainText('Оберег ответа')
    await page.getByTitle('Личное дело', { exact: true }).first().click()
    await expect(page.locator('.card-list').first()).toContainText('Поражений')
    await expect(page.locator('.card-list').first()).toContainText('Следующий уровень')
  })

  test('expired session redirects instead of rendering empty Stage 2 data', async ({ page }) => {
    await page.goto('/login')
    await page.evaluate(() => {
      localStorage.setItem('mmo_token', 'expired-token')
      localStorage.setItem('mmo_user', JSON.stringify({ userId: 'expired', login: 'expired' }))
    })
    await page.goto('/work')
    // Вход возвращает туда, откуда выкинуло: адрес страницы едет в next.
    await expect(page).toHaveURL(/\/login\?next=%2Fwork&reason=session-expired$/)
    await expect(page.locator('form')).toBeVisible()
  })

  // Коды районов — единственная связь карты города с территориями Этапа 4:
  // бэкенд пишет их в ProductionObject.locationId и по ним же считает, чей
  // район и кого можно атаковать. Связь держится на совпадении строк, поэтому
  // список закреплён с обеих сторон: тут и в backend/src/tests/unit/districts.
  // Переименовали район здесь — упадёт этот тест, а не территории на проде.
  test('district codes stay the six the backend pins territories to', async () => {
    expect(MENU.districts.map(district => district.key)).toEqual([
      'center', 'market', 'industrial', 'station', 'garages', 'suburb',
    ])
  })

  test('location tabs stay below the illustration with legible labels', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop stage geometry')
    await authPage(page, seller)
    await page.goto('/industrial')
    await expect(page.locator('.city-locations')).toBeVisible()
    await expect(page.locator('.stage-nav')).toHaveCount(0)
    const geometry = await page.evaluate(() => {
      const viewport = document.querySelector('.viewport')!.getBoundingClientRect()
      const tabs = document.querySelector('.city-locations')!.getBoundingClientRect()
      return { bottom: viewport.bottom, top: tabs.top }
    })
    expect(geometry.top).toBeGreaterThan(geometry.bottom)
  })

  test('desktop scene fills side bands without distorting the authored plate', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop stage only')
    await authPage(page, seller)

    for (const route of ['/', '/profile']) {
      await page.goto(route)
      // Без ожидания замер иногда уходил в null: goto резолвится по load,
      // а сцену рисует React уже после него — под нагрузкой полного прогона
      // это давало падение «Cannot read properties of null».
      await page.locator('.stage').waitFor({ state: 'attached' })
      const geometry = await page.evaluate(() => {
        const stage = document.querySelector<HTMLElement>('.stage')!.getBoundingClientRect()
        const backdrop = document.querySelector<HTMLElement>('.stage-backdrop')!.getBoundingClientRect()
        return {
          ratio: stage.width / stage.height,
          backdropLeft: backdrop.left,
          backdropRight: backdrop.right,
          viewportWidth: window.innerWidth,
        }
      })
      // Главный экран показывает полную композицию макета: чат развёрнут
      // по умолчанию и занимает свою полосу, а не ложится поверх сцены.
      const expectedRatio = route === '/' ? 1550 / 900 : 1600 / 900
      expect(Math.abs(geometry.ratio - expectedRatio)).toBeLessThan(0.001)
      expect(geometry.backdropLeft).toBeLessThanOrEqual(0)
      expect(geometry.backdropRight).toBeGreaterThanOrEqual(geometry.viewportWidth)
    }
  })

  // Правило чата (правка заказчика, октябрь 2026): чат статичный — всегда
  // развёрнут, без кнопки сворачивания, и занимает свою полосу макета под
  // интерфейсом, а не ложится поверх него.
  test('city chat is always open and keeps its own band below the interface', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop stage only')
    await authPage(page, seller)
    await page.goto('/')

    await expect(page.locator('.chat-dock')).toHaveCount(1)
    await expect(page.locator('.chat-dock__tab')).toHaveCount(0)
    await expect(page.locator('.chat-dock__window')).toBeVisible()

    const geometry = await page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('.stage')!.getBoundingClientRect()
      const view = document.querySelector<HTMLElement>('.viewport')!.getBoundingClientRect()
      const panel = document.querySelector<HTMLElement>('.chat-dock')!.getBoundingClientRect()
      return { ratio: stage.width / stage.height, viewBottom: view.bottom, panelTop: panel.top }
    })
    expect(geometry.panelTop).toBeGreaterThanOrEqual(geometry.viewBottom - 1)
    expect(Math.abs(geometry.ratio - 1550 / 900)).toBeLessThan(0.001)
  })

  test('E2 work page lists every workplace the API returns', async ({ page }, testInfo) => {
    // Число вакансий числом здесь фиксировать нельзя: сид растёт с каждым
    // этапом, и тест падал бы на добавлении контента, а не на дефекте.
    // Сверяем таблицу с тем, что отдаёт API тому же персонажу.
    const objects = await apiContext.get('/api/work/objects', {
      headers: { Authorization: `Bearer ${seller.token}` },
    })
    expect(objects.status()).toBe(200)
    const expected = (await objects.json() as { items: unknown[] }).items.length
    expect(expected).toBeGreaterThan(0)

    await authPage(page, seller)
    await page.goto('/work')
    await expect(page.getByText('Рабочая смена')).toBeVisible()
    await expect(page.getByText('Вакансии', { exact: true })).toBeVisible()
    await expect(page.locator('#vacancies tbody tr')).toHaveCount(expected)
    await visualProof(page, testInfo, 'e2-work')
  })

  test('work browser flow requires a profession and a tool, buys them and starts a shift', async ({ page }, testInfo) => {
    // Профессии покупаются в Училище: работа их больше не выдаёт.
    const listed = await apiContext.get('/api/work/objects', { headers: { Authorization: `Bearer ${worker.token}` } })
    expect(listed.status()).toBe(200)
    type Vacancy = { name: string; requiredProfessionCode: string; equipment: { requiredToolTier: number } | null; admission: unknown }
    const vacancy = (await listed.json() as { items: Vacancy[] }).items
      .find(item => item.equipment?.requiredToolTier === 1 && !item.admission)
    expect(vacancy).toBeTruthy()
    const row = page.locator('#vacancies tbody tr', { hasText: vacancy!.name }).first()

    await authPage(page, worker)
    await page.goto('/work')
    await expect(row.getByText(/не изучена/)).toBeVisible()
    await expect(row.getByRole('button', { name: 'Выйти' })).toBeDisabled()
    const learned = await apiContext.post('/api/city/professions', {
      headers: { Authorization: `Bearer ${worker.token}`, 'Idempotency-Key': `visual-learn-${worker.login}` },
      data: { code: vacancy!.requiredProfessionCode },
    })
    expect(learned.status()).toBe(200)

    await page.reload()
    await expect(row.getByText(/Нужен инструмент T1/)).toBeVisible()

    const shop = await apiContext.get('/api/shops/government/items', { headers: { Authorization: `Bearer ${worker.token}` } })
    expect(shop.status()).toBe(200)
    const tool = (await shop.json() as Array<{ templateId: string; template: { type: string; toolTier: number | null } }>).find(item => item.template.type === 'TOOL' && item.template.toolTier === 1)
    expect(tool).toBeTruthy()
    const purchase = await apiContext.post('/api/shops/government/buy', {
      headers: { Authorization: `Bearer ${worker.token}`, 'Idempotency-Key': `visual-gov-buy-${worker.login}` },
      data: { templateId: tool!.templateId },
    })
    expect(purchase.status()).toBe(201)

    await page.reload()
    const start = row.getByRole('button', { name: 'Выйти' })
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
    // Витрина переехала с таблицы на плитки по макету «Фон основного меню
    // Магазин»: уровень выбирается селектором, а не рядом кнопок.
    await authPage(page, seller)
    await page.goto('/shop')
    // Вкладки по месту на теле (правка 28.10): пистолет 2-го уровня — в «Стрелковом».
    await page.getByRole('button', { name: 'Стрелковое', exact: true }).click()
    const cards = page.locator('.gshop-card')
    await expect(cards.first()).toBeVisible()
    await page.getByLabel('Для уровня:').selectOption('2')
    await expect(cards).not.toHaveCount(0)
    // Считаем только картинку товара: рамки кнопок — тоже <img>, но они
    // декоративные и к наличию изображения предмета отношения не имеют.
    expect(await cards.locator('img:not(.gshop-frame)').count()).toBe(await cards.count())
    await visualProof(page, testInfo, 'government-weapons-level-2')
  })

  test('location navigation exposes districts first and contextual rooms second', async ({ page }) => {
    // Подписи комнат берём из карты города: они меняются с каждым этапом,
    // а прибитый в тесте текст ломается на переименовании, а не на дефекте.
    await authPage(page, seller)

    // Правка заказчика: в локации полоса — ЦЕНТР и разделы самой локации.
    await page.goto('/industrial')
    const strip = page.getByRole('navigation', { name: 'Разделы локации' })
    // Вкладки «Промзона» с названием самой локации нет: это был дубль ЦЕНТРа (правка 20.10).
    for (const label of ['ЦЕНТР', 'Работа', 'Мои объекты', 'Рецепты']) {
      const button = strip.getByRole('button', { name: label, exact: true })
      await button.scrollIntoViewIfNeeded()
      await expect(button).toBeVisible()
    }
    // Других локаций в полосе нет: переходы только через Центр.
    await expect(strip.getByRole('button', { name: 'Фермы', exact: true })).toHaveCount(0)

    // Аграрного района в макете нет; старый адрес уводит в Промзону.
    await page.goto('/agriculture')
    await expect(page).toHaveURL(/\/district\/industrial$/)
    await expect(page.getByRole('button', { name: 'Работа', exact: true })).toBeVisible()

    // комнаты чужого района в полосе не появляются
    await page.goto('/district/garages')
    await expect(page.getByRole('button', { name: 'Работа', exact: true })).toHaveCount(0)
  })

  test('visual navigation has one visible control per destination', async ({ page }, testInfo) => {
    await authPage(page, seller)

    for (const route of ['/', '/district/industrial', '/district/station', '/district/garages']) {
      await page.goto(route)
      const labels = await page.locator('.city-locations button:visible').evaluateAll(elements =>
        elements.map(element => (element.textContent ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru'))
          .filter(Boolean),
      )
      expect(new Set(labels).size, `duplicate visible controls on ${route}`).toBe(labels.length)
    }

    await page.goto('/market')
    await page.getByRole('button', { name: 'Частные лавки', exact: true }).click()
    await expect(page).toHaveURL(/\/shops\/private$/)

    if (testInfo.project.name.startsWith('mobile')) {
      await page.goto('/')
      await page.locator('.m-tabbar__btn').nth(2).click()
      const sheet = page.locator('.m-sheet')
      await expect(sheet).toHaveAttribute('aria-modal', 'true')
      await expect(sheet).toHaveAttribute('aria-label', 'Главное меню')
      await expect(sheet.locator(':focus')).toHaveCount(1)
      await sheet.getByRole('button', { name: 'история боёв' }).click()
      await expect(page).toHaveURL(/\/battles\/history$/)
    }
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
    await expect(page.locator('.panel input[type="number"]')).not.toHaveCount(0)
    await expect(page.locator('.panel select')).not.toHaveCount(0)
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
    // Панель государства теперь занята вставкой камней, как и рисует
    // макет «Фон основного мнею Улучшения»: три слота — предмет, камень
    // и огранка — и столбец цен по сортам. Повышение уровня со своим
    // шансом переехало в «Кузницу», раздел рядом.
    await expect(page.getByText('Государственная вставка камней')).toBeVisible()
    const selector = page.locator('select').first()
    // Одна вещь покупателя и пункт «выберите»: вторая вещь раньше приходила
    // с рынка, а теперь на общем рынке только ресурсы (правка 21.10).
    await expect(selector.locator('option')).toHaveCount(2)
    // Столбец сортов приходит правилами и от выбранной вещи не зависит.
    // Ищем именно строку прайса: то же название стоит ещё и пунктом в
    // списке выбора камня, а getByText нашёл бы оба и упал бы на строгом
    // режиме.
    await expect(page.locator('.upg-price__row').filter({ hasText: 'Камень мутный' })).toHaveCount(1)
    await selector.selectOption({ index: 1 })
    await page.locator('select').nth(2).selectOption('ARMOR')
    await expect(page.getByRole('button', { name: 'Вставить' })).toBeVisible()

    await page.getByRole('button', { name: 'Кузница', exact: true }).click()
    await page.locator('select').first().selectOption({ index: 1 })
    await page.locator('select').nth(1).selectOption('ARMOR')
    await expect(page.getByText('шанс', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Улучшить' })).toBeVisible()
    await visualProof(page, testInfo, 'e5-upgrades')
  })

  test('battle v3 fits one screen and submits one attack with two blocks', async ({ page }, testInfo) => {
    const started = await apiContext.post('/api/battles/pve/start', {
      headers: { Authorization: `Bearer ${fighter.token}` },
      data: { botCode: 'training_bandit' },
    })
    expect(started.status()).toBe(201)
    const battleId = (await started.json() as { battleId: string }).battleId

    // This browser case verifies the intent UI and submitted payload. Range and
    // pathfinding have separate server tests, so expose both hand controls here.
    await page.route(new RegExp(`/api/battles/${battleId}$`), async route => {
      const response = await route.fetch()
      const body = await response.json() as { participantProfiles?: Array<{ primaryRange: number; secondaryRange: number }> }
      body.participantProfiles?.forEach(profile => { profile.primaryRange = 99; profile.secondaryRange = 99 })
      await route.fulfill({ response, json: body })
    })

    await authPage(page, fighter)
    await page.goto(`/battle/${battleId}`)
    await expect(page.locator('.designer-battle-field')).toBeVisible()
    // размер поля берём из таблицы, снятой с PSD: числом здесь его
    // фиксировать нельзя — решётка меняется вместе с артом
    await expect(page.locator('.hex-cell')).toHaveCount(DESIGNER_BATTLE_COLUMNS * DESIGNER_BATTLE_ROWS)
    expect(await page.locator('.designer-battle-field').evaluate(element => getComputedStyle(element).backgroundImage)).not.toBe('none')

    if (testInfo.project.name.startsWith('desktop')) {
      // Компьютер (правка заказчика 22.10): бой на сцене города — своя
      // карточка слева, противник справа, зоны маленькими списками.
      await expect(page.locator('.battle-desk')).toBeVisible()
      await expect(page.locator('.zone-list')).toHaveCount(2)
      await expect(page.locator('.battle-desk__side .card-cutout')).toBeVisible()
      const page_ = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      }))
      expect(page_.documentWidth).toBeLessThanOrEqual(page_.viewportWidth + 1)
      expect(page_.documentHeight).toBeLessThanOrEqual(page_.viewportHeight + 1)
      await page.getByRole('button', { name: 'Удар правой рукой, цель: голова', exact: true }).click()
      await page.getByRole('button', { name: 'Поставить блок: корпус', exact: true }).click()
      await page.getByRole('button', { name: 'Поставить блок: ноги', exact: true }).click()
    } else {
      // Телефон (правка заказчика 23.10): бой потоковой композицией m-battle —
      // шапка с таймером, строка HP обоих бойцов, поле, списки зон, хроника.
      await expect(page.locator('.m-battle')).toBeVisible()
      await expect(page.locator('.m-battle__fighter')).toHaveCount(2)
      await expect(page.locator('.m-battle__zones .zone-list')).toHaveCount(2)

      // Бой занимает весь экран без прокрутки.
      const geometry = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }))
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1)
      expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewportHeight + 1)

      // Списки зон — те же, что на сцене у компьютера: кнопки рук и блоков
      // называются одинаково на обоих экранах.
      await page.getByRole('button', { name: 'Удар правой рукой, цель: голова', exact: true }).click()
      await page.getByRole('button', { name: 'Поставить блок: корпус', exact: true }).click()
      await page.getByRole('button', { name: 'Поставить блок: ноги', exact: true }).click()
    }

    const actionRequest = page.waitForRequest(request => request.url().endsWith(`/api/battles/${battleId}/action`))
    await page.locator('.battle-submit-turn').click()
    const payload = (await actionRequest).postDataJSON() as {
      action: string; stance: string; attackZones: string[]; attackHands: string[]; blockZones: string[]; targetParticipantId: string
    }
    expect(payload).toMatchObject({
      action: 'attack', stance: 'mixed', attackZones: ['HEAD'], attackHands: ['RIGHT_HAND'], blockZones: ['CHEST', 'LEGS'],
    })
    expect(payload.targetParticipantId).toBeTruthy()

    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(axe.violations).toEqual([])
    const image = await page.screenshot({ animations: 'disabled' })
    await testInfo.attach(`battle-v3-${testInfo.project.name}`, { body: image, contentType: 'image/png' })

    await apiContext.post(`/api/battles/${battleId}/action`, {
      headers: { Authorization: `Bearer ${fighter.token}` }, data: { action: 'surrender' },
    })
  })

  test('Stage 2 pages meet automated WCAG A/AA checks and expose keyboard focus', async ({ page }, testInfo) => {
    await authPage(page, seller)
    const routes = [
      '/work', '/resources', '/shops/private', '/market', '/upgrades',
      '/shop', '/repair', '/stats', '/pvp', '/soon/farms',
    ]

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

