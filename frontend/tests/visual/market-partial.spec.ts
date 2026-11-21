import { expect, test } from '@playwright/test'

test('частичная покупка отправляет котировку и повторяет её с тем же ключом', async ({ page }) => {
  const listingId = '00000000-0000-4000-8000-000000000141'
  const character = {
    id: 'me', userId: 'u', nickname: 'Торгаш', archetype: 'WORKER', status: 'ACTIVE',
    money: 5000, battleLevel: 30, productionLevel: 1, economicLevel: 1, hpMax: 100, hpCurrent: 100,
    stats: { str: 3, end: 3, luck: 3, agi: 3, acc: 3, agr: 3, rea: 3, aluck: 3 },
  }
  let remaining = 10
  const keys: string[] = []
  const bodies: unknown[] = []
  await page.addInitScript(() => {
    localStorage.setItem('mmo_token', 'fixture-token')
    localStorage.setItem('mmo_user', JSON.stringify({ userId: 'u', login: 'qa' }))
    sessionStorage.setItem('mmo_resumed', '1')
  })
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/buy')) {
      keys.push(route.request().headers()['idempotency-key'])
      bodies.push(route.request().postDataJSON())
      if (keys.length === 1) return route.abort()
      remaining = 8
      return route.fulfill({ json: { amount: 2, remainingAmount: remaining } })
    }
    if (url.pathname.endsWith('/quote')) {
      const amount = Number(url.searchParams.get('amount'))
      return route.fulfill({ json: { amount, available: 10, revision: 3, currency: 'RUB', finalPrice: amount * 100 } })
    }
    if (url.pathname === '/api/market/listings') {
      return route.fulfill({ json: { page: 1, totalPages: 1, total: 1, items: [{
        id: listingId, status: 'ACTIVE', type: 'RESOURCE', currency: 'RUB', canBuyPart: true,
        resourceAmount: remaining, price: remaining * 100, sellerNickname: 'Продавец', sellerUrl: '/u/seller',
        resource: { name: 'Металлолом', code: 'scrap', tier: 1 }, expiresAt: '2026-12-10T00:00:00Z',
      }] } })
    }
    if (url.pathname === '/api/characters/me') return route.fulfill({ json: character })
    if (url.pathname === '/api/inventory') return route.fulfill({ json: [] })
    const json = url.pathname.startsWith('/api/chat') ? { items: [] } : {}
    return route.fulfill({ json })
  })

  await page.goto('/market')
  const lot = page.getByRole('row').filter({ hasText: 'Металлолом' })
  await lot.getByRole('button', { name: 'Купить' }).click()
  await lot.getByRole('spinbutton', { name: 'Количество для покупки' }).fill('2')
  await expect(lot).toContainText('200 ₽ за 2 шт.')
  await lot.getByRole('button', { name: 'Подтвердить покупку' }).click()
  await lot.getByRole('button', { name: 'Повторить подтверждение' }).click()
  await expect(page.getByText('Куплено: 2 шт.')).toBeVisible()
  await expect(lot).toContainText('800 ₽')
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies).toEqual([{ amount: 2, revision: 3, finalPrice: 200 }, { amount: 2, revision: 3, finalPrice: 200 }])
})
