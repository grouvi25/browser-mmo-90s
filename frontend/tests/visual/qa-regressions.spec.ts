import { expect, test, type Page } from '@playwright/test'
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

async function authenticate(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('mmo_token', 'fixture-token')
    localStorage.setItem('mmo_user', JSON.stringify({ userId: 'u', login: 'qa' }))
    sessionStorage.setItem('mmo_resumed', '1')
  })
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
function battle(round = 7, foe = enemy) {
  return { battle: { id: battleId, type: 'PVE_BOT', status: 'ACTIVE', participants: [], startedAt: '2026-10-21T12:00:00Z' }, liveState: { roundNumber: round, roundDeadline: Date.now() + 60000, distance: 8, participants: [player, foe] }, participantProfiles: [profile, { ...profile, participantId: 'e', name: 'Хулиган' }] }
}

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
  await authenticate(page); await mockApi(page, () => battle())
  await page.goto(`/battle/${battleId}`)
  await expect(page.locator('.battle-header-v3, .battle-desk__head')).toContainText('Раунд 7 / 30')
  await expect(page.locator('.battle-field-v3__meta')).toHaveText('Дистанция: 1Дальность: 1')
  await expect(page.getByRole('button', { name: 'Удар левой рукой, цель: голова', exact: true })).toBeEnabled()
  await expect(page.getByRole('region', { name: 'Хроника боя' })).toContainText('удар в корпус, −5 HP')
  await page.reload()
  await expect(page.locator('.battle-header-v3, .battle-desk__head')).toContainText('Раунд 7 / 30')
  await expect(page.getByRole('region', { name: 'Хроника боя' })).toContainText('удар в корпус, −5 HP')
  expect(errors).toEqual([])
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
  await expect(page.locator('.battle-field-v3__meta')).toHaveText('Дистанция: 1Дальность: 1')
  await expect(page.locator('.battle-header-v3, .battle-desk__head')).toContainText('Раунд 9 / 30')
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
  await expect(page.locator('.battle-header-v3, .battle-desk__head')).toContainText('Раунд 7 / 30')
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
  await page.getByPlaceholder('Ваш логин').fill('qa'); await page.getByPlaceholder('Пароль').fill('test-password')
  await page.getByRole('button', { name: 'Войти в игру' }).click()
  await expect(page).toHaveURL(new RegExp(`/battle/${battleId}$`))
  await expect(page.locator('.battle-header-v3, .battle-desk__head')).toContainText('Раунд 7')
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
  await page.getByPlaceholder('Ваш логин').fill('qa')
  await page.getByPlaceholder('Пароль').fill('test-password')
  await page.getByRole('button', { name: 'Войти в игру' }).click()
  await expect(page).toHaveURL(/\/inventory\?tab=weapons#list$/)
  await expect(page.getByText('Склад', { exact: true }).first()).toBeVisible()
})

test('desktop online panel renders only connected players over cleaned paper', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop plate only; mobile uses a separate dynamic list')
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await authenticate(page); await mockApi(page, () => battle())
  await page.goto('/inventory')
  await expect(page.locator('.online-title')).toHaveText('Игроки онлайн: 1')
  await expect(page.locator('.online-list__row')).toHaveCount(1)
  await expect(page.locator('.online-list-paper')).toBeVisible()
  await expect(page.locator('.online-title')).not.toHaveAttribute('title', /демонстрационный/)
  await testInfo.attach('clean-online-panel', { body: await page.locator('.chat-dock').screenshot(), contentType: 'image/png' })
  expect(errors).toEqual([])
})
