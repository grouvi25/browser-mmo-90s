import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'
import { battleDisplayState, canSelectBattleMove } from '../../src/pages/battle/battle-view-model'
import { hexNeighbours } from '../../src/shared/lib/hex'
import { loginDestination, loginUrl } from '../../src/shared/lib/login-redirect'

const battleId = '00000000-0000-4000-8000-000000000001'
const player = { participantId: 'p', characterId: 'me', side: 1, position: { x: 1, y: 4 }, hpCurrent: 80, hpMax: 100, isAlive: true, isSurrendered: false, hasActedThisRound: false, damageDealt: 0, damageReceived: 0 }
const adjacent = hexNeighbours(player.position)[0]
const enemy = { ...player, participantId: 'e', characterId: undefined, botId: 'bot', side: 2, hpCurrent: 60, position: adjacent }
const profile = { participantId: 'p', name: 'Проверка', primaryRange: 1, secondaryRange: 1 }
const character = { id: 'me', userId: 'u', nickname: 'Проверка', archetype: 'ATHLETE', battleLevel: 1, economicLevel: 1, productionLevel: 1, battleExp: 0, economicExp: 0, productionExp: 0, money: 25000, hpCurrent: 80, hpMax: 100, status: 'IN_BATTLE', gender: 'MALE', stats: { str: 3, agi: 3, rea: 3, acc: 3, end: 3, luck: 3, agr: 3, auth: 3 }, weaponSkills: [], battlesTotal: 1, battlesWon: 0 }
const journal = { battle: { id: battleId, status: 'ACTIVE', rounds: 7 }, total: 1, page: 1, pages: 1, items: [{ id: 'persisted', round: 6, at: '2026-10-21T12:00:00Z', actor: 'Проверка', target: 'Хулиган', side: 1, kind: 'hit', text: 'удар в корпус, −5 HP' }] }

async function authenticate(page: Page, resumed = true) {
  await page.addInitScript(resumed => {
    localStorage.setItem('mmo_token', 'fixture-token')
    localStorage.setItem('mmo_user', JSON.stringify({ userId: 'u', login: 'qa' }))
    if (resumed) sessionStorage.setItem('mmo_resumed', '1')
    // Подсказки обучения затемняют экран: здесь проверяется не обучение (city-tutorial.spec.ts).
    sessionStorage.setItem('mmo_tour_paused', '1')
  }, resumed)
}

async function mockApi(page: Page, battle: () => unknown, action?: () => { status?: number; data: unknown }, noCharacter = false) {
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname
    let data: unknown = {}
    let status = 200
    if (path === '/api/characters/me') {
      data = noCharacter ? { code: 'CHAR_001', message: 'Персонаж не найден' } : character
      status = noCharacter ? 404 : 200
    } else if (path === '/api/characters/creation-config') data = { startMoney: 25000 }
    else if (path === `/api/battles/${battleId}`) data = battle()
    else if (path === `/api/battles/${battleId}/journal`) data = journal
    else if (path === `/api/battles/${battleId}/action`) {
      const result = action?.() ?? { data: {} }; data = result.data; status = result.status ?? 200
    } else if (path === '/api/battles/me/current') data = { battleId: null, application: null }
    else if (path === '/api/auth/login') data = { token: 'fixture-token', userId: 'u', login: 'qa' }
    else if (path === '/api/city/location') data = { path: '/forum' }
    else if (path.includes('/inventory')) data = []
    else if (path === '/api/chat/online/list') data = { players: [{ characterId: 'me', nickname: 'Проверка', level: 1 }] }
    else if (path.startsWith('/api/chat')) data = { items: [], messages: [], limits: { maxBody: 400, minGapMs: 1500 } }
    await route.fulfill({ status, json: data })
  })
}

const librarySection = { id: 'custom-library', title: 'Правила города', body: 'Очков за уровень: {{очки_за_уровень}}\n\n[[боевые уровни]]' }

// Дима 23.11: новичок появляется на площади и проходит обучение, письмо Бывалого — после него.
test('новый персонаж выходит на Центральную площадь и начинает обучение', async ({ page }) => {
  await authenticate(page, false)
  // Здесь проверяется само обучение: подсказки включены.
  await page.addInitScript(() => sessionStorage.removeItem('mmo_tour_paused'))
  await mockApi(page, () => battle(), undefined, true)
  let created = false
  await page.route('**/api/characters/me', route => created
    ? route.fulfill({ json: { ...character, status: 'ACTIVE' } })
    : route.fulfill({ status: 404, json: { code: 'CHAR_001', message: 'Персонаж не найден' } }))
  await page.route('**/api/characters', route => {
    created = true
    return route.fulfill({ status: 201, json: { ...character, status: 'ACTIVE' } })
  })
  await page.route('**/api/characters/tutorial', route => route.fulfill({ json: {
    active: true, completed: false, letterPending: false, reward: { rubles: 5000, dollars: 100 },
    lesson: 'buy', weapon: { id: 'knife', name: 'Нож-бабочка', weaponType: 'KNIFE', price: 500, canAfford: true },
  } }))
  await page.goto('/character/create')
  await page.getByRole('button', { name: 'Создать персонажа' }).click()
  const intro = page.getByRole('dialog', { name: 'Первые шаги' })
  await expect(intro).toBeVisible()
  await expect(intro.getByRole('button', { name: 'Начать' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Кодекс выживания приезжего' })).toHaveCount(0)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('img[alt="Центральная площадь"]')).toBeAttached()
})

test('в мобильной хронике длинное попадание и урон помещаются целиком', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Мобильная хроника')
  await page.setViewportSize({ width: 320, height: 680 })
  await authenticate(page)
  await mockApi(page, () => battle())
  const longHit = 'крито-удачный, пробил блок в левую руку, −147 HP — снял бронежилет, отражено −17 HP'
  await page.route(url => url.pathname === '/api/battles/' + battleId + '/journal', route => route.fulfill({ json: {
    ...journal, items: [{ ...journal.items[0], kind: 'critlucky', actor: 'ОченьДлинныйНикАтакующего', target: 'ОченьДлинныйНикЗащитника', text: longHit }],
  } }))
  await page.goto('/battle/' + battleId)
  const line = page.getByRole('region', { name: 'Хроника боя' }).locator('.battle-chronicle__label')
  await expect(line).toContainText('−147 HP')
  await expect(line).toContainText('−17 HP')
  await expect(line).toHaveCSS('white-space', 'normal')
  expect(await line.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
  await expect(page.getByRole('dialog', { name: 'Лог боя' })).toHaveCount(0)
})

test('поддержка в Android WebView даёт ссылку на ту же форму в браузере', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv)' })
  })
  await authenticate(page)
  await mockApi(page, () => battle())
  await page.goto('/support/new')
  await expect(page.getByRole('link', { name: 'откройте эту страницу в браузере телефона' }))
    .toHaveAttribute('href', 'https://kooperativ.space/support/new')
  await expect(page.getByRole('button', { name: /Приложить скриншоты/ })).toBeEnabled()
})

test('открытие черновика переводит к редактору объявления', async ({ page }) => {
  const drafts = Array.from({ length: 4 }, (_, index) => ({
    id: `draft-${index}`, kind: 'PATCH', title: `Обновление ${index + 1}`,
    body: 'Изменения в игре. '.repeat(32), createdAt: '2026-11-18T12:00:00Z', pinned: false,
  }))
  await page.addInitScript(() => localStorage.setItem('mmo_admin_token', 'fixture-admin-token'))
  await page.route('**/api/admin/auth/me', route => route.fulfill({ json: { permissions: ['content'] } }))
  await page.route('**/api/admin/site/welcome', route => route.fulfill({ json: { welcome: null } }))
  await page.route('**/api/announcements/admin', route => route.fulfill({ json: { items: [] } }))
  await page.route('**/api/announcements/admin/drafts', route => route.fulfill({ json: { items: drafts } }))
  await page.goto('/admin/news')
  await page.getByRole('article').filter({ hasText: drafts[0].title }).getByRole('button', { name: 'Открыть и править' }).click()
  const editor = page.getByRole('region', { name: 'Черновик', exact: true })
  await expect(editor).toBeFocused()
  await expect(editor.getByRole('textbox', { name: 'Заголовок' })).toHaveValue(drafts[0].title)
  await expect(editor.getByRole('textbox', { name: 'Заголовок' })).toBeInViewport()
})

test('library stays empty when there are no published sections', async ({ page }) => {
  await authenticate(page)
  await mockApi(page, () => ({}))
  await page.route('**/api/content/library', route => route.fulfill({ json: { items: [] } }))

  await page.goto('/library')
  await expect(page.getByText('В библиотеке пока нет опубликованных разделов')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Разделы библиотеки' })).toHaveCount(0)
})

test('library offers a retry when published sections fail to load', async ({ page }) => {
  await authenticate(page)
  await mockApi(page, () => ({}))
  let failed = true
  await page.route('**/api/content/library', route => failed
    ? route.fulfill({ status: 503, json: {} })
    : route.fulfill({ json: { items: [librarySection] } }))
  await page.route('**/api/library/tables', route => route.fulfill({ json: { battle: [], statPointsPerLevel: 3 } }))

  await page.goto('/library')
  await expect(page.getByRole('alert')).toContainText('Раздел не загрузился')
  failed = false
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('button', { name: librarySection.title })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('article')).toContainText('Очков за уровень: 3')
})

test('library keeps the chapter readable while live tables can be retried', async ({ page }) => {
  await authenticate(page)
  await mockApi(page, () => ({}))
  await page.route('**/api/content/library', route => route.fulfill({ json: { items: [librarySection] } }))
  let failed = true
  await page.route('**/api/library/tables', route => failed
    ? route.fulfill({ status: 503, json: {} })
    : route.fulfill({ json: { battle: [], statPointsPerLevel: 3 } }))

  await page.goto('/library')
  await expect(page.getByRole('alert')).toContainText('Таблицы и числа не загрузились')
  await expect(page.getByText('Очков за уровень: —')).toBeVisible()
  await expect(page.getByText('Загружаем таблицу…')).toHaveCount(0)
  failed = false
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByText('Очков за уровень: 3')).toBeVisible()
})

function battle(round = 7, foe = enemy) {
  return { battle: { id: battleId, type: 'PVE_BOT', status: 'ACTIVE', participants: [], startedAt: '2026-10-21T12:00:00Z' }, liveState: { roundNumber: round, roundDeadline: Date.now() + 60000, distance: 8, participants: [player, foe] }, participantProfiles: [profile, { ...profile, participantId: 'e', name: 'Хулиган' }] }
}

test('chat keeps its position while reading history and dismisses the smile panel', async ({ page }) => {
  await authenticate(page)
  await mockApi(page, () => battle())
  const createdAt = new Date().toISOString()
  const line = (number: number) => ({
    id: `chat-${number}`, channel: 'GLOBAL', scope: '',
    authorId: 'another', nickname: 'Игрок', level: 1,
    body: `Реплика ${number}`, createdAt,
  })
  const messages = Array.from({ length: 45 }, (_, index) => line(index))
  await page.route('**/api/chat/global', route => route.fulfill({ json: { messages, limits: { maxBody: 400, minGapMs: 1500 } } }))
  let socket: WebSocketRoute | undefined
  await page.routeWebSocket('**/socket.io/**', ws => {
    ws.send('0{"sid":"mock-engine","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}')
    ws.onMessage(message => {
      if (typeof message !== 'string' || !message.startsWith('40')) return
      socket = ws
      ws.send('40{"sid":"mock-chat"}')
    })
  })
  await page.goto(`/battle/${battleId}`)
  const log = page.locator('.city-chat, .m-battle__chat .m-chat__log').filter({ visible: true })
  await expect(log.getByText('Реплика 44', { exact: true })).toBeVisible()
  await expect.poll(() => Boolean(socket)).toBe(true)
  const read = () => log.evaluate(box => ({ top: box.scrollTop, bottomGap: box.scrollHeight - box.clientHeight - box.scrollTop }))
  await expect.poll(async () => (await read()).bottomGap).toBeLessThan(2)
  await log.evaluate(box => { box.scrollTop = 36; box.dispatchEvent(new Event('scroll')) })
  const position = (await read()).top
  socket?.send('42' + JSON.stringify(['chat:message', line(45)]))
  await expect(log.getByText('Реплика 45', { exact: true })).toBeVisible()
  expect((await read()).top).toBe(position)
  await log.evaluate(box => { box.scrollTop = box.scrollHeight; box.dispatchEvent(new Event('scroll')) })
  socket?.send('42' + JSON.stringify(['chat:message', line(46)]))
  await expect(log.getByText('Реплика 46', { exact: true })).toBeVisible()
  await expect.poll(async () => (await read()).bottomGap).toBeLessThan(2)

  const composer = page.locator('.ether-composer--city, .m-battle__chat .m-chat__form').filter({ visible: true })
  const toggle = composer.getByRole('button', { name: 'Смайлики' })
  const picker = composer.getByRole('listbox', { name: 'Смайлики' })
  await toggle.click()
  await expect(picker).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await toggle.click()
  await composer.locator('.ether-input').click()
  await expect(picker).toHaveCount(0)
})

test('missing tools are reported beside the helper who could not start work', async ({ page }) => {
  await authenticate(page)
  await mockApi(page, () => ({}))
  const helper = { id: 'one', name: 'Ткач для проверки', kind: 'WORK', status: 'ACTIVE', professionCode: 'WEAVER', professionLevel: 1, professionExp: 0, skillCap: 3, activeShift: null }
  await page.route('**/api/helpers', route => route.fulfill({ json: { items: [helper, { ...helper, id: 'two', name: 'Другой помощник' }], dailyShiftCap: 20, slots: { used: 2, total: 2 } } }))
  const field = { id: 'field', name: 'Хлопковое поле', requiredProfessionCode: 'WEAVER', requiredProfessionLevel: 1, ownerType: 'SYSTEM', workerSlots: 5, shiftDurationMinutes: 5 }
  await page.route('**/api/helpers/objects', route => route.fulfill({ json: { items: [field, { ...field, id: 'mill', name: 'Мастерская' }] } }))
  await page.route('**/api/helpers/one/work', route => route.fulfill({ status: 400, json: { code: 'WORK_011', message: 'Нужен инструмент: Ножницы' } }))
  await page.goto('/premium/helpers')
  await expect(page.getByText(/Норма для каждого рабочего помощника — 20 смен в сутки/)).toBeVisible()
  const card = page.locator('.s4-helper', { hasText: helper.name })
  await expect(card.getByRole('option', { name: /Хлопковое поле.*5 мин/ })).toHaveCount(1)
  await card.getByRole('button', { name: 'На смену' }).click()
  await expect(card.getByRole('status')).toContainText('Нужен инструмент: Ножницы')
  await expect(page.locator('.s4-helper', { hasText: 'Другой помощник' }).getByRole('status')).toHaveCount(0)
  await card.getByRole('combobox').selectOption('mill')
  await expect(card.getByRole('status')).toHaveCount(0)
})

test('subscription shop separates the current personal total and limits advertised to buyers', async ({ page }) => {
  await authenticate(page)
  await mockApi(page, () => ({}))
  await page.route('**/api/dollars/me', route => route.fulfill({ json: { dollars: 0, isDealer: false, history: [] } }))
  await page.route('**/api/dollars/dealers', route => route.fulfill({ json: { items: [] } }))
  await page.route('**/api/premium/me', route => route.fulfill({ json: {
    isPremium: false, dailyShiftCap: 13,
    benefits: { skillMultiplier: 1, helperSlots: 0, dailyShiftCap: 12, loadoutSlots: 2 },
  } }))
  await page.route('**/api/premium/shop', route => route.fulfill({ json: {
    subscriptionLimits: { personalBase: 16, perHelper: 20 },
    items: [{ code: 'prem_sub_30', name: 'Подписка на 30 дней', description: 'Доступ к помощникам', kind: 'TIME', priceRub: 299, priceDollars: 125, grantCode: 'SUBSCRIPTION_DAYS' }],
  } }))
  await page.goto('/premium')
  const personal = page.locator('.s4-stat', { hasText: 'Личный лимит смен' })
  await expect(personal.locator('b')).toHaveText('13')
  await expect(personal).toContainText('12 базовых · бонус +1')
  const product = page.locator('.s4-goods', { hasText: 'Подписка на 30 дней' })
  await expect(product).toContainText('Личных смен в сутки — 16 базовых плюс бонусы')
  await expect(product).toContainText('На каждого рабочего помощника — 20 смен в сутки')
})

test('Rambler Top100 uses renewed consent, counts navigation and skips reset URLs', async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
    if (!sessionStorage.getItem('cookie-fixture-seeded')) {
      sessionStorage.setItem('cookie-fixture-seeded', '1')
      localStorage.setItem('kooperativ_cookies', 'all')
    }
  })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname !== 'kooperativ.space') return route.abort()
    const response = await route.fetch({ url: new URL(url.pathname + url.search, baseURL).href })
    await route.fulfill({ response })
  })
  await page.route('https://st.top100.ru/top100/top100.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      window.top100 = function (options) {
        window.top100Project = options.project;
        window.top100Manual = options.manualControl;
        window.top100Pages = [];
        this.trackPageview = function () { window.top100Pages.push(location.pathname) };
      };
      window._top100q.forEach(callback => callback());
    `,
  }))
  await page.goto('https://kooperativ.space/cookies')
  await expect(page.locator('#rambler-top100')).toHaveCount(0)
  await page.getByRole('button', { name: 'Принять все' }).click()
  const hits = () => page.evaluate(() => (window as typeof window & { top100Pages?: string[] }).top100Pages)
  await expect.poll(hits).toEqual(['/cookies'])
  expect(await page.evaluate(() => {
    const w = window as typeof window & { top100Project?: number; top100Manual?: boolean }
    return [w.top100Project, w.top100Manual]
  })).toEqual([7753811, true])

  const navigate = (path: string) => page.evaluate(url => {
    history.pushState(history.state, '', url)
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  }, path)
  await navigate('/soglashenie')
  await expect.poll(hits).toEqual(['/cookies', '/soglashenie'])
  await navigate('/reset-password?token=fixture-secret')
  await expect(page).toHaveURL(/reset-password/)
  await navigate('/cookies')
  await expect.poll(hits).toEqual(['/cookies', '/soglashenie', '/cookies'])
  await page.getByRole('button', { name: 'Изменить выбор' }).click()
  await expect(page.getByRole('button', { name: 'Только необходимые' })).toBeVisible()
  await expect(page.locator('#rambler-top100')).toHaveCount(0)
})

test('new live data supersedes old action distance, HP and range; reload restores round', () => {
  const base = { live: { roundNumber: 7, distance: 8 }, player, enemy, profile, dataUpdatedAt: 200 }
  expect(battleDisplayState({ ...base, action: { receivedAt: 100, targetId: 'e', distance: 2, playerHp: 99, botHp: 90, playerRange: 4, roundNumber: 2 } })).toEqual({ round: 7, distance: 1, range: 1, playerHp: 80, enemyHp: 60 })
  expect(battleDisplayState({ ...base, action: { receivedAt: 300, targetId: 'e', distance: 2, playerHp: 75, botHp: 55, roundNumber: 7 } })).toMatchObject({ round: 8, distance: 2, playerHp: 75, enemyHp: 55 })
  expect(battleDisplayState({ ...base, action: { receivedAt: 300, roundNumber: 7, waiting: true } }).round).toBe(7)
  expect(battleDisplayState({ ...base, action: { receivedAt: 300, targetId: 'another-enemy', distance: 8, botHp: 1 } })).toMatchObject({ distance: 1, enemyHp: 60 })
  expect(battleDisplayState({ ...base, profile: { primaryRange: 1, secondaryRange: 4 } }).range).toBe(4)
})

test('a stale destination is rejected if occupied, nonadjacent, dead or already acted', () => {
  const [free, other] = hexNeighbours(player.position)
  expect(canSelectBattleMove(player, free, [player])).toBe(true)
  expect(canSelectBattleMove(player, free, [player, { ...enemy, position: free }])).toBe(false)
  expect(canSelectBattleMove(player, free, [{ ...enemy, position: free, isAlive: false }])).toBe(true)
  expect(canSelectBattleMove(player, player.position, [])).toBe(false)
  expect(canSelectBattleMove({ ...player, hasActedThisRound: true }, other, [])).toBe(false)
  expect(canSelectBattleMove({ ...player, isAlive: false }, other, [])).toBe(false)
})

test('login destination preserves requested URL and rejects external redirects and auth loops', () => {
  const desired = '/inventory?tab=weapons#list'
  expect(loginDestination(new URL(loginUrl(desired, true), 'https://game.test').search)).toBe(desired)
  for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/%2fexample.com', '/%5cevil.test', '/login', '/login?next=/inventory', '/admin', '/resume', '/register', '/%0aevil.test', '/bad%']) {
    expect(loginDestination(`?next=${encodeURIComponent(value)}`)).toBe('/resume')
  }
  expect(loginDestination('')).toBe('/resume')
})

test('battle reload restores server round, range, target distance and persisted chronicle', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await authenticate(page); await mockApi(page, () => {
    const data = battle()
    return { ...data, participantProfiles: [profile, { ...data.participantProfiles[1], primaryHand: 'Пистолет ПМ', primaryRange: 5 }] }
  })
  await page.goto(`/battle/${battleId}`)
  await expect(page.locator('.battle-header-v3, .battle-desk__head, .m-battle__head')).toContainText('Раунд 7 / 30')
  await expect(page.locator('.battle-field-v3__meta')).toContainText(/Дистанция: 1\s*Дальность: 1/)
  await expect(page.locator('.battle-field-v3__opponent')).toContainText('Пистолет ПМ · 5 кл.')
  await expect(page.locator('.battle-field-v3__opponent')).toContainText('Бот ходит автоматически')
  await expect(page.getByRole('button', { name: 'Удар левой рукой, цель: голова', exact: true })).toBeEnabled()
  await expect(page.getByRole('region', { name: 'Хроника боя' })).toContainText('удар в корпус, −5 HP')
  await page.reload()
  await expect(page.locator('.battle-header-v3, .battle-desk__head, .m-battle__head')).toContainText('Раунд 7 / 30')
  await expect(page.getByRole('region', { name: 'Хроника боя' })).toContainText('удар в корпус, −5 HP')
  expect(errors).toEqual([])
})

test('приглашение с главной доходит до регистрации без сохранения в браузере', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'koop_ref') throw new DOMException('Storage unavailable', 'SecurityError')
      setItem.call(this, key, value)
    }
  })
  await mockApi(page, () => ({}))
  await page.goto('/?ref=%D0%9F%D1%80%D0%B8%D0%B3%D0%BB%D0%B0%D1%81%D0%B8%D0%B2%D1%88%D0%B8%D0%B9')
  await page.getByRole('link', { name: 'Начать свой путь' }).click()
  await expect(page.getByLabel(/Кто пригласил/)).toHaveValue('Пригласивший')
})

test('расклад оружия показывает обе границы с учётом прежних очков и улучшений', async ({ page }) => {
  await authenticate(page)
  await mockApi(page, () => ({}))
  await page.route('**/api/characters/me', route => route.fulfill({ json: { ...character, status: 'ACTIVE' } }))
  await page.route('**/api/inventory', route => route.fulfill({ json: [{
    id: 'named-pistol', templateId: 'named-pistol', ownerId: 'me', quality: 'COMMON',
    durabilityCurrent: 100, durabilityMax: 100, upgradeLevel: 1, status: 'NORMAL', isEquipped: false,
    weight: 1, budget: 20, freePoints: 17, damagePerPoint: 5, statAllocation: { DAMAGE: 1, MAX_DAMAGE: 2 },
    fixedDamageAllocation: { DAMAGE: 1, MIN_DAMAGE: 1 },
    template: { type: 'WEAPON', name: 'Пистолет', code: 'weapon_pistol_pm', minDamage: 10, maxDamage: 50, maxRange: 4, allocationMode: 'PLAYER', levelReq: 0 },
  }] }))
  await page.goto('/inventory')
  await page.getByRole('button', { name: 'Настроить' }).click()
  const dialog = page.getByRole('dialog', { name: 'Пистолет' })
  // С 24.11 урон показывается в HP: те же числа ×0,35 (10–50 → 3,5–17,5 HP).
  await expect(dialog).toContainText('Базовый урон оружия 3,5–17,5 HP')
  await expect(dialog).toContainText('Урон оружия с этим раскладом 5,95–22,4 HP')
  await dialog.getByRole('spinbutton', { name: /Макс\. урон/ }).fill('4')
  await expect(dialog).toContainText('Урон оружия с этим раскладом 5,95–25,9 HP')
  const bounds = await dialog.boundingBox()
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
})

test('action override expires when polling observes an automatic round', async ({ page }) => {
  let round = 7; let foe = { ...enemy, position: { x: 7, y: 4 } }
  await authenticate(page)
  await mockApi(page, () => battle(round, foe), () => ({ data: { roundNumber: 7, distance: 2, playerRange: 1, playerHp: 78, botHp: 60, turns: [] } }))
  await page.goto(`/battle/${battleId}`)
  for (const name of ['голова', 'корпус', 'левая рука', 'правая рука']) await page.getByRole('button', { name: `Поставить блок: ${name}`, exact: true }).click()
  await page.locator('.battle-submit-turn').click()
  // Simulate server timeout advancing the round after our previous action.
  round = 9; foe = enemy
  await expect(page.locator('.battle-field-v3__meta')).toContainText(/Дистанция: 1\s*Дальность: 1/)
  await expect(page.locator('.battle-header-v3, .battle-desk__head, .m-battle__head')).toContainText('Раунд 9 / 30')
  await expect(page.getByRole('button', { name: 'Удар левой рукой, цель: голова', exact: true })).toBeEnabled()
})

test('move error clears the selected cell, refreshes the board and shows Russian advice', async ({ page }) => {
  let reads = 0
  await authenticate(page)
  await mockApi(page, () => { reads++; return battle() }, () => ({ status: 400, data: { code: 'BATTLE_004', message: 'Клетка занята или недоступна. Выберите соседнюю свободную клетку.' } }))
  await page.goto(`/battle/${battleId}`)
  await page.getByRole('button', { name: /^Перейти в клетку/ }).first().click()
  await expect(page.locator('.battle-submit-turn')).toHaveText('Перейти')
  const before = reads; await page.locator('.battle-submit-turn').click()
  await expect(page.getByRole('alert')).toContainText('Выберите соседнюю свободную клетку')
  await expect(page.locator('.battle-submit-turn')).toHaveText('Применить')
  await expect(page.locator('.hex-cell.is-selected')).toHaveCount(0)
  await expect.poll(() => reads).toBeGreaterThan(before)
})

test('polling clears a destination that the enemy has taken', async ({ page }) => {
  let foe = enemy
  await authenticate(page); await mockApi(page, () => battle(7, foe))
  await page.goto(`/battle/${battleId}`)
  // Пока бой не загружен, поле рисует бойца на клетке по умолчанию: номер
  // клетки читаем только после загрузки, иначе он разойдётся с кликом.
  await expect(page.locator('.battle-header-v3, .battle-desk__head, .m-battle__head')).toContainText('Раунд 7 / 30')
  await expect(page.locator('.hex-cell.is-player')).toHaveCount(1)
  const cell = page.getByRole('button', { name: /^Перейти в клетку/ }).first()
  const label = await cell.getAttribute('aria-label'); const [x, y] = label!.split(' ').pop()!.split(':').map(Number)
  await cell.click(); await expect(page.locator('.battle-submit-turn')).toHaveText('Перейти')
  foe = { ...enemy, position: { x, y } }
  await expect(page.locator('.hex-cell.is-selected')).toHaveCount(0)
  await expect(page.locator('.battle-submit-turn')).toHaveText('Применить')
})

test('protected URL survives login instead of resuming a different last location', async ({ page }) => {
  await mockApi(page, () => battle())
  await page.goto('/battle/' + battleId)
  await expect(page).toHaveURL(/\/login\?next=/)
  await page.getByPlaceholder('Ваш ник').fill('qa'); await page.getByPlaceholder('Пароль').fill('test-password')
  await page.getByRole('button', { name: 'Войти в игру' }).click()
  await expect(page).toHaveURL(new RegExp(`/battle/${battleId}$`))
  await expect(page.locator('.battle-header-v3, .battle-desk__head, .m-battle__head')).toContainText('Раунд 7')
})

test('character creation displays live 25000 rather than hardcoded 1250', async ({ page }) => {
  await authenticate(page); await mockApi(page, () => battle(), undefined, true)
  await page.goto('/character/create')
  await expect(page.locator('td.money')).toHaveText(/25\s000/)
  await expect(page.locator('td.money')).not.toHaveText(/1\s250/)
})


test('inventory deep link wins over the previously saved forum location', async ({ page }) => {
  await mockApi(page, () => battle())
  await page.goto('/inventory?tab=weapons#list')
  await expect(page).toHaveURL(/\/login\?next=/)
  await page.getByPlaceholder('Ваш ник').fill('qa')
  await page.getByPlaceholder('Пароль').fill('test-password')
  await page.getByRole('button', { name: 'Войти в игру' }).click()
  await expect(page).toHaveURL(/\/inventory\?tab=weapons#list$/)
  await expect(page.getByText('Склад', { exact: true }).first()).toBeVisible()
})

test('desktop online panel renders the server list over cleaned paper', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop plate only; mobile uses a separate dynamic list')
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await authenticate(page); await mockApi(page, () => battle())
  await page.goto('/inventory')
  await expect(page.locator('.online-title')).toContainText('Игроки онлайн: 1')
  await expect(page.locator('.online-list__row')).toHaveCount(1)
  await expect(page.locator('.online-list-paper')).toBeVisible()
  await expect(page.locator('.online-title')).not.toHaveAttribute('title', /демонстрационный/)
  await testInfo.attach('clean-online-panel', { body: await page.locator('.chat-dock').screenshot(), contentType: 'image/png' })
  expect(errors).toEqual([])
})

test('городской персонаж в общем онлайне открывает карточку характеристик', async ({ page }, testInfo) => {
  await authenticate(page)
  await mockApi(page, () => battle())
  await page.route('**/api/chat/online/list', route => route.fulfill({ json: { players: [
    { characterId: 'me', nickname: 'Проверка', level: 1 },
    { characterId: 'resident:cassette', nickname: 'VHS90', level: 5,
      resident: { occupation: 'Ткач', productionLevel: 6, stats: { str: 4, agi: 10, end: 6, acc: 8 } } },
  ] } }))
  await page.goto('/inventory')
  if (testInfo.project.name === 'mobile-chromium') {
    await page.locator('.m-tabbar').getByRole('button', { name: 'Чат', exact: true }).click()
    await page.getByRole('button', { name: 'Онлайн: 2' }).click()
  }
  const row = page.locator('.online-list__row:visible, .m-chat__player-row:visible').filter({ hasText: 'VHS90' })
  await expect(row).toContainText('5')
  await expect(row.locator('.ether-arrow')).toHaveCount(0)
  await row.getByRole('button', { name: 'VHS90' }).click()
  const dialog = page.getByRole('dialog', { name: 'VHS90' })
  await expect(dialog).toContainText('Ткач')
  await expect(dialog).toContainText(/Уровень производства\s*6/)
  await expect(dialog).toContainText(/Ловкость\s*10/)
  if (testInfo.project.name === 'mobile-chromium') await page.keyboard.press('Escape')
  else await dialog.getByRole('button', { name: 'Закрыть' }).click()
  await expect(dialog).toBeHidden()
  await expect(row).toBeVisible()
  await expect(page).toHaveURL(/\/inventory$/)
})
