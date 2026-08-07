import { prisma, disconnectDb } from '../shared/db/prisma'
import { disconnectRedis } from '../shared/db/redis'
import { hashPassword } from '../shared/security/password'

const LOGIN = 'stage2_prod_smoke'
const EMAIL = 'stage2-prod-smoke@internal.invalid'
const NICKNAME = 'Stage2 Smoke'
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'https://game.grouvi.online'
const password = process.env.SMOKE_PASSWORD

if (!password || password.length < 24) {
  throw new Error('SMOKE_PASSWORD must contain at least 24 characters')
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function jsonRequest(path: string, init: RequestInit = {}, expected = 200): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const text = await response.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (response.status !== expected) {
    throw new Error(`${init.method ?? 'GET'} ${path}: expected ${expected}, got ${response.status}: ${text.slice(0, 300)}`)
  }
  return body
}

async function ensureSmokeAccount(): Promise<void> {
  const passwordHash = await hashPassword(password!)
  const user = await prisma.user.upsert({
    where: { login: LOGIN },
    update: { passwordHash, status: 'ACTIVE', emailVerified: true },
    create: { login: LOGIN, email: EMAIL, passwordHash, status: 'ACTIVE', emailVerified: true },
  })

  const existing = await prisma.character.findUnique({ where: { userId: user.id } })
  if (!existing) {
    const character = await prisma.character.create({
      data: {
        userId: user.id,
        nickname: NICKNAME,
        archetype: 'WORKER',
        hpCurrent: 86,
        hpMax: 86,
        money: 1250,
      },
    })
    await prisma.characterStats.create({
      data: { characterId: character.id, str: 4, end: 4 },
    })
  } else if (existing.status !== 'ACTIVE') {
    await prisma.character.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } })
  }
}

async function main(): Promise<void> {
  await ensureSmokeAccount()

  const login = await jsonRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: LOGIN, password }),
  }) as { token?: string; userId?: string }
  assert(login.token && login.userId, 'Login response is missing token/userId')
  const headers = { Authorization: `Bearer ${login.token}` }

  const auth = await jsonRequest('/api/auth/me', { headers }) as { userId?: string }
  assert(auth.userId === login.userId, 'Authenticated user mismatch')

  const profile = await jsonRequest('/api/characters/me', { headers }) as {
    id?: string
    economy?: { productionLevel?: number; economicLevel?: number; activeShift?: unknown }
  }
  assert(profile.id, 'Character profile is missing')
  assert(typeof profile.economy?.productionLevel === 'number', 'Profile production level is missing')
  assert(typeof profile.economy?.economicLevel === 'number', 'Profile economic level is missing')
  assert('activeShift' in (profile.economy ?? {}), 'Profile activeShift is missing')

  const loadout = await jsonRequest('/api/characters/me/battle-loadout', { headers }) as { itemInstanceIds?: unknown[] }
  assert(Array.isArray(loadout.itemInstanceIds), 'Battle loadout contract is invalid')

  const work = await jsonRequest('/api/work/objects', { headers }) as {
    items?: Array<{ requiredProfessionCode?: string; requiredProfessionLevel?: number; profession?: { code?: string; level?: number } }>
    professions?: unknown[]
    daily?: { shiftsLimit?: number }
  }
  assert(Array.isArray(work.items) && work.items.length >= 6, 'Production object seed is incomplete')
  assert(work.items.every(item => typeof item.requiredProfessionCode === 'string' && typeof item.requiredProfessionLevel === 'number' && item.profession?.code === item.requiredProfessionCode), 'Profession object contract is invalid')
  assert(Array.isArray(work.professions), 'Character professions contract is invalid')
  assert(work.daily?.shiftsLimit === 8, 'Daily shift limit contract is invalid')

  const currentShift = await jsonRequest('/api/work/shifts/current', { headers }) as { daily?: { shiftsLimit?: number } }
  assert(currentShift.daily?.shiftsLimit === 8, 'Current shift contract is invalid')

  const resources = await jsonRequest('/api/resources', { headers }) as { items?: unknown[]; totalWeight?: number }
  assert(Array.isArray(resources.items) && typeof resources.totalWeight === 'number', 'Resources contract is invalid')

  const shops = await jsonRequest('/api/private-shops', { headers }) as Array<{ code?: string }>
  assert(Array.isArray(shops) && shops.some(shop => shop.code === 'kommersant'), 'Kommersant shop is missing')
  assert(shops.some(shop => shop.code === 'armory_garage'), 'Armory garage is missing')

  const privateItems = await jsonRequest('/api/private-shops/kommersant/items', { headers }) as unknown[]
  assert(Array.isArray(privateItems) && privateItems.length >= 5, 'Private shop seed is incomplete')

  const market = await jsonRequest('/api/market/listings?page=1&limit=5', { headers }) as {
    items?: unknown[]
    total?: number
    totalPages?: number
  }
  assert(Array.isArray(market.items) && typeof market.total === 'number', 'Market contract is invalid')
  assert(typeof market.totalPages === 'number', 'Market pagination contract is invalid')

  const upgrades = await jsonRequest('/api/upgrades/items', { headers })
  assert(Array.isArray(upgrades), 'Upgrades items contract is invalid')

  await jsonRequest('/api/auth/logout', { method: 'POST', headers }, 200)
  console.log(JSON.stringify({ ok: true, baseUrl: BASE_URL, checks: 11 }))
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDb()
    await disconnectRedis()
  })
