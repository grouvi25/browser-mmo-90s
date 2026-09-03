import { expect, request as playwrightRequest, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'
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
    fighter = await createAccount(apiContext, `fighter_${testInfo.project.name}`)
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
    await expect(page.locator('.arch-card')).toHaveCount(8)
    await page.locator('.arch-card').nth(1).click()
    await expect(page.locator('.arch-card').nth(1)).toHaveAttribute('aria-pressed', 'true')
    await page.locator('input[type="text"]').fill(`Hero_${suffix}`.slice(0, 30))
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.locator('body')).toContainText(`Hero_${suffix}`.slice(0, 30))
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
      data: { login, email: `${login}@visual.local`, password },
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

  test('illustrated navigation labels stay centred in their frames', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Illustrated stage navigation is desktop-only')
    await authPage(page, seller)
    await page.goto('/industrial')
    // Число районов и комнат берём из карты города, а не числом: районы
    // нарисованы на подложке и не меняются, а комнаты растут с этапами.
    await expect(page.locator('.stage-nav')).toHaveCount(2)
    await expect(page.locator('.stage-nav').nth(0).locator('.stage-nav__button')).toHaveCount(MENU.districts.length)
    await expect(page.locator('.stage-nav').nth(1).locator('.stage-nav__button')).toHaveCount(MENU.rooms.industrial.length)

    const offsets = await page.locator('.stage-nav__button').evaluateAll(buttons => buttons.map(button => {
      const frame = button.querySelector<HTMLElement>('.stage-nav__frame')!.getBoundingClientRect()
      const label = button.querySelector<HTMLElement>('.stage-nav__label-text')!.getBoundingClientRect()
      return {
        dx: Math.abs((label.left + label.right - frame.left - frame.right) / 2),
        inside: label.left >= frame.left - 0.1 && label.right <= frame.right + 0.1,
      }
    }))

    for (const offset of offsets) {
      expect(offset.dx).toBeLessThan(0.25)
      expect(offset.inside).toBe(true)
    }
  })

  test('desktop scene fills side bands without distorting the authored plate', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop stage only')
    await authPage(page, seller)

    for (const route of ['/', '/profile']) {
      await page.goto(route)
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
      const expectedRatio = route === '/' ? 1550 / 900 : 1600 / 900
      expect(Math.abs(geometry.ratio - expectedRatio)).toBeLessThan(0.001)
      expect(geometry.backdropLeft).toBeLessThanOrEqual(0)
      expect(geometry.backdropRight).toBeGreaterThanOrEqual(geometry.viewportWidth)
    }
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

  test('work browser flow requires a tool, buys it and starts a shift', async ({ page }, testInfo) => {
    await authPage(page, worker)
    await page.goto('/work')
    await expect(page.getByText(/Нужен инструмент T1/).first()).toBeVisible()

    const shop = await apiContext.get('/api/shops/government/items', { headers: { Authorization: `Bearer ${worker.token}` } })
    expect(shop.status()).toBe(200)
    const tool = (await shop.json() as Array<{ templateId: string; template: { type: string; toolTier: number | null } }>).find(item => item.template.type === 'TOOL' && item.template.toolTier === 1)
    expect(tool).toBeTruthy()
    const purchase = await apiContext.post('/api/shops/government/buy', {
      headers: { Authorization: `Bearer ${worker.token}` }, data: { templateId: tool!.templateId },
    })
    expect(purchase.status()).toBe(201)

    await page.reload()
    const start = page.locator('#vacancies').getByRole('button', { name: 'Выйти' }).first()
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
    await page.getByRole('button', { name: 'Оружие', exact: true }).click()
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

    await page.goto('/industrial')
    await expect(page.getByRole('button', { name: 'Промзона', exact: true })).toBeVisible()
    for (const room of MENU.rooms.industrial) {
      await expect(page.getByRole('button', { name: room.label, exact: true })).toBeVisible()
    }

    // Аграрного района в макете нет; ферма и растения — комнаты Промзоны,
    // и старый адрес обязан уводить туда же.
    await page.goto('/agriculture')
    await expect(page).toHaveURL(/\/district\/industrial$/)
    await expect(page.getByRole('button', { name: 'Промзона', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ферма', exact: true })).toBeVisible()

    // комнаты чужого района в полосе не появляются
    await page.goto('/district/garages')
    await expect(page.getByRole('button', { name: 'Работа', exact: true })).toHaveCount(0)
  })

  test('visual navigation has one visible control per destination', async ({ page }, testInfo) => {
    await authPage(page, seller)

    for (const route of ['/', '/district/industrial', '/district/station', '/district/garages']) {
      await page.goto(route)
      const labels = await page.locator('button:visible, a[href]:visible').evaluateAll(elements =>
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
    // Подписи взяты с макета «Фон основного мнею Улучшения»: панель там
    // называется «Государственная вставка камней», кнопка — «Вставить»,
    // а шанс стоит одной строкой вместе с ценой и ступенью. Проверка
    // прежняя: список вещей, выбор усиления, живой расчёт и кнопка.
    await expect(page.getByText('Государственная вставка камней')).toBeVisible()
    const selector = page.locator('select').first()
    await expect(selector.locator('option')).toHaveCount(3)
    await page.locator('select').nth(1).selectOption('ARMOR')
    await selector.selectOption({ index: 1 })
    await expect(page.getByText('шанс', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Вставить' })).toBeVisible()
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
    await expect(page.locator('.battle-page-v3')).toBeVisible()
    await expect(page.locator('.battle-fighter-panel')).toHaveCount(2)
    await expect(page.locator('.battle-command-dock')).toBeVisible()
    await expect(page.locator('.designer-battle-field')).toBeVisible()
    // размер поля берём из таблицы, снятой с PSD: числом здесь его
    // фиксировать нельзя — решётка меняется вместе с артом
    await expect(page.locator('.hex-cell')).toHaveCount(DESIGNER_BATTLE_COLUMNS * DESIGNER_BATTLE_ROWS)
    expect(await page.locator('.designer-battle-field').evaluate(element => getComputedStyle(element).backgroundImage)).not.toBe('none')

    // Экран боя — фиксированная сцена макета, ужатая под окно. Мерить её
    // scrollHeight бессмысленно: он показывает размер ДО масштабирования,
    // то есть всегда 1312 или 1600. Смотрим то, что видит игрок: сцена
    // после масштабирования влезает в окно и документ не прокручивается.
    const geometry = await page.locator('.battle-mockup-scene').evaluate(element => {
      const box = element.getBoundingClientRect()
      return {
        sceneWidth: box.width,
        sceneHeight: box.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
      }
    })
    expect(geometry.sceneWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1)
    expect(geometry.sceneHeight).toBeLessThanOrEqual(geometry.viewportHeight + 1)
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1)
    expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewportHeight + 1)

    // Обе панели стоят в один ряд — и на десктопе, и на телефоне: так их
    // рисует макет, и ради этого сцена вписывается целиком.
    const rows = await page.locator('.battle-fighter-panel').evaluateAll(
      panels => panels.map(panel => Math.round(panel.getBoundingClientRect().y)))
    expect(new Set(rows).size, 'панели зон должны стоять на одной строке').toBe(1)

    await page.locator('.battle-fighter-panel.is-enemy .battle-zone-cell.is-head').nth(1).click()
    // Десять ячеек — ровно столько нарисовано в макете: у головы, корпуса
    // и каждой руки по две, у каждой ноги по одной. Ноги разведены в
    // отдельные зоны, поэтому второй ячейки им не положено.
    await expect(page.locator('.battle-fighter-panel.is-self .battle-zone-cell')).toHaveCount(10)
    await page.locator('.battle-fighter-panel.is-self .battle-zone-cell.is-chest').first().click()
    await page.locator('.battle-fighter-panel.is-self .battle-zone-cell.is-left-leg').first().click()

    const actionRequest = page.waitForRequest(request => request.url().endsWith(`/api/battles/${battleId}/action`))
    await page.locator('.battle-submit-turn').click()
    const payload = (await actionRequest).postDataJSON() as {
      action: string; stance: string; attackZones: string[]; attackHands: string[]; blockZones: string[]; targetParticipantId: string
    }
    expect(payload).toMatchObject({
      action: 'attack', stance: 'mixed', attackZones: ['HEAD'], attackHands: ['RIGHT_HAND'], blockZones: ['CHEST', 'LEFT_LEG'],
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

