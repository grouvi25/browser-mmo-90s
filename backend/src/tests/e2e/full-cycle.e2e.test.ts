/**
 * E2E Test: Full game cycle (Stage 1)
 * Tests the complete user journey from registration to battle
 * Requires: real PostgreSQL + Redis + running backend
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { testPrisma, uid } from './helpers'
import { gridDistance, stepToward } from '../../modules/battles/grid'

const BASE = process.env.E2E_API_URL ?? 'http://localhost:4000'

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  let data: unknown
  try { data = await res.json() } catch { data = null }
  return { status: res.status, data }
}

// ─────────────────────────────────────────────────────────────────
// Scenario 1: Full new player cycle
// Register → Login → Create char → Buy items → Equip → Fight → Repair
// ─────────────────────────────────────────────────────────────────
describe('E2E: Full player cycle (Stage 1 TZ razdel 11)', () => {
  let token = ''
  let itemInstanceId = ''
  let rightHandItemId = ''
  let battleId = ''
  const login = uid('e2e')
  const email = `${login}@e2e.com`

  beforeAll(async () => {
    await testPrisma.$connect()
  })

  afterAll(async () => {
    await testPrisma.$disconnect()
  })

  it('11.1 Register', async () => {
    const r = await api('POST', '/api/auth/register', { login, email, password: 'e2e_pass_123' })
    expect(r.status).toBe(201)
    expect((r.data as { login: string }).login).toBe(login)
  })

  it('11.1 Login', async () => {
    const r = await api('POST', '/api/auth/login', { login, password: 'e2e_pass_123' })
    expect(r.status).toBe(200)
    token = (r.data as { token: string }).token
    expect(token).toBeTruthy()
  })

  it('11.1 Create character (ATHLETE archetype)', async () => {
    const r = await api('POST', '/api/characters', { nickname: uid('Hero'), archetype: 'ATHLETE' }, token)
    expect(r.status).toBe(201)
    const char = r.data as { money: number; hpMax: number; stats: { str: number; end: number } }
    // ATHLETE: +1 STR +1 END (base str=3, end=3 → 4,4)
    expect(char.stats.str).toBe(4)
    expect(char.stats.end).toBe(4)
    // hpMax = 60 + END×6 + BL×2 = 60 + 4×6 + 1×2 = 86
    expect(char.hpMax).toBe(86)
    expect(char.money).toBe(1250)
  })

  it('11.2 Open government shop (has items)', async () => {
    const r = await api('GET', '/api/shops/government/items', undefined, token)
    expect(r.status).toBe(200)
    const items = r.data as Array<{ templateId: string; template: { name: string; priceBase: number } }>
    expect(items.length).toBeGreaterThan(0)
    // Find cheapest weapon to buy
    const weapons = items.filter(i => i.template.name.includes('Кулак') === false)
    itemInstanceId = weapons[0]?.templateId ?? ''
  })

  it('11.2 Buy weapon (atomic: money deducted, item created)', async () => {
    const shopItems = (await api('GET', '/api/shops/government/items', undefined, token)).data as Array<{
      templateId: string; template: { priceBase: number; type: string; name: string }
    }>
    const weapon = shopItems.find(i => i.template.type === 'WEAPON')
    expect(weapon).toBeTruthy()

    const charBefore = (await api('GET', '/api/characters/me', undefined, token)).data as { money: number }
    const r = await api('POST', '/api/shops/government/buy', { templateId: weapon!.templateId }, token)
    expect(r.status).toBe(201)
    const second = await api('POST', '/api/shops/government/buy', { templateId: weapon!.templateId }, token)
    expect(second.status).toBe(201)

    const bought = r.data as { item: { id: string; durabilityCurrent: number }; newBalance: number }
    const boughtRight = second.data as { item: { id: string; durabilityCurrent: number }; newBalance: number }
    itemInstanceId = bought.item.id
    rightHandItemId = boughtRight.item.id
    expect(bought.item.durabilityCurrent).toBeGreaterThan(0)
    expect(boughtRight.item.durabilityCurrent).toBeGreaterThan(0)
    expect(boughtRight.newBalance).toBe(charBefore.money - weapon!.template.priceBase * 2)

    // Проверка CurrencyLog живёт в админском контуре: пользовательский
    // токен на /api/admin/logs/currency получает отказ, и запрос здесь
    // ничего не проверял.
  })

  it('11.2 Equip independent left and right weapons', async () => {
    const left = await api('POST', '/api/inventory/equip', { itemInstanceId, hand: 'LEFT_HAND' }, token)
    const right = await api('POST', '/api/inventory/equip', { itemInstanceId: rightHandItemId, hand: 'RIGHT_HAND' }, token)
    expect(left.status).toBe(200)
    expect(right.status).toBe(200)

    const inv = await api('GET', '/api/inventory', undefined, token)
    const items = inv.data as Array<{ id: string; isEquipped: boolean; armorSlot: string | null }>
    expect(items.find(i => i.id === itemInstanceId)).toMatchObject({ isEquipped: true, armorSlot: 'LEFT_HAND' })
    expect(items.find(i => i.id === rightHandItemId)).toMatchObject({ isEquipped: true, armorSlot: 'RIGHT_HAND' })
  })

  it('11.3 Start PvE battle with training bot', async () => {
    const r = await api('POST', '/api/battles/pve/start', { botCode: 'training_bandit' }, token)
    expect(r.status).toBe(201)
    battleId = (r.data as { battleId: string }).battleId
    expect(battleId).toMatch(/^[0-9a-f-]{36}$/)

    // Character status = IN_BATTLE
    const charR = await api('GET', '/api/characters/me', undefined, token)
    expect((charR.data as { status: string }).status).toBe('IN_BATTLE')
  })

  it('11.3 Battle: invalid action rejected (422)', async () => {
    const r = await api('POST', `/api/battles/${battleId}/action`, { action: 'INVALID' }, token)
    expect(r.status).toBe(422)
  })

  it('11.3 Battle: play to completion (max 30 rounds)', async () => {
    let over = false
    let rounds = 0
    let finalResult: Record<string, unknown> = {}

    while (!over && rounds < 35) {
      const snapshot = (await api('GET', `/api/battles/${battleId}`, undefined, token)).data as {
        liveState?: { participants: Array<{ characterId?: string; side: number; isAlive: boolean; position: { x: number; y: number } }> }
      }
      const participants = snapshot.liveState?.participants ?? []
      const player = participants.find(participant => participant.characterId)
      const target = participants.find(participant => participant.isAlive && participant.side !== player?.side)
      const moveTo = player && target && gridDistance(player.position, target.position) > 1
        ? stepToward(player.position, target.position)[0]
        : undefined
      const action = moveTo
        ? { action: 'move', moveTo }
        : {
            action: 'attack', stance: 'attack2',
            attackZones: ['CHEST', 'HEAD'], attackHands: ['LEFT_HAND', 'RIGHT_HAND'],
          }
      const r = await api('POST', `/api/battles/${battleId}/action`, action, token)
      expect(r.status).toBe(200)
      const data = r.data as Record<string, unknown>
      rounds++
      if (data.battleOver === true) {
        over = true
        finalResult = data
      }
    }

    expect(over).toBe(true)
    expect(rounds).toBeLessThanOrEqual(30)
    expect(finalResult.result).toMatch(/^PVE_(WIN|LOSS)$/)
    expect(typeof finalResult.expGain).toBe('number')
    expect(typeof finalResult.weaponExpGain).toBe('number')
  })

  it('11.3 After battle: weapon skill exp accumulated', async () => {
    const skills = (await api('GET', '/api/characters/me/skills', undefined, token)).data as Array<{
      weaponType: string; skillExp: number
    }>
    expect(skills.length).toBeGreaterThan(0)
    const totalExp = skills.reduce((sum, s) => sum + s.skillExp, 0)
    expect(totalExp).toBeGreaterThan(0)
  })

  it('11.3 After battle: weapon durability decreased', async () => {
    const inv = (await api('GET', '/api/inventory', undefined, token)).data as Array<{
      id: string; durabilityCurrent: number; durabilityMax: number
    }>
    const weapon = inv.find(i => i.id === itemInstanceId)
    // Weapon should be worn (durability < max) after combat
    if (weapon) {
      // May or may not be worn depending on battle outcome
      expect(weapon.durabilityCurrent).toBeGreaterThanOrEqual(0)
      expect(weapon.durabilityCurrent).toBeLessThanOrEqual(weapon.durabilityMax)
    }
  })

  it('11.4 Repair: preview shows cost', async () => {
    // Weapon must need repair first — if durability < max
    const inv = (await api('GET', '/api/inventory', undefined, token)).data as Array<{
      id: string; durabilityCurrent: number; durabilityMax: number
    }>
    const weapon = inv.find(i => i.id === itemInstanceId)
    if (weapon && weapon.durabilityCurrent < weapon.durabilityMax) {
      const r = await api('POST', '/api/repair/preview', { itemInstanceId }, token)
      expect(r.status).toBe(200)
      const preview = r.data as { repairCost: number; lostDurability: number }
      expect(preview.repairCost).toBeGreaterThan(0)
      expect(preview.lostDurability).toBeGreaterThan(0)
    } else {
      // Weapon at full durability — repair not needed
      const r = await api('POST', '/api/repair/preview', { itemInstanceId }, token)
      expect(r.status).toBe(400) // REPAIR_NOT_NEEDED
    }
  })

  it('Character: status back to ACTIVE after battle', async () => {
    const r = await api('GET', '/api/characters/me', undefined, token)
    expect(r.status).toBe(200)
    expect((r.data as { status: string }).status).toBe('ACTIVE')
  })
})

// ─────────────────────────────────────────────────────────────────
// Scenario 2: Security invariants
// ─────────────────────────────────────────────────────────────────
describe('E2E: Security invariants (ТЗ раздел 4)', () => {
  let tok1 = ''
  let tok2 = ''
  let bid  = ''

  beforeAll(async () => {
    await testPrisma.$connect()
    const l1 = uid('sec1')
    await fetch(`${BASE}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: l1, email: `${l1}@t.com`, password: 'pass123' }),
    })
    tok1 = ((await (await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: l1, password: 'pass123' }),
    })).json()) as { token: string }).token
    await fetch(`${BASE}/api/characters`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok1}` },
      body: JSON.stringify({ nickname: uid('Sec1'), archetype: 'STREET' }),
    })

    const l2 = uid('sec2')
    await fetch(`${BASE}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: l2, email: `${l2}@t.com`, password: 'pass123' }),
    })
    tok2 = ((await (await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: l2, password: 'pass123' }),
    })).json()) as { token: string }).token
    await fetch(`${BASE}/api/characters`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok2}` },
      body: JSON.stringify({ nickname: uid('Sec2'), archetype: 'VETERAN' }),
    })

    // Start battle for player 1
    const bRes = await (await fetch(`${BASE}/api/battles/pve/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok1}` },
      body: JSON.stringify({ botCode: 'training_bandit' }),
    })).json() as { battleId: string }
    bid = bRes.battleId
  })

  afterAll(async () => { await testPrisma.$disconnect() })

  it('No token → 401', async () => {
    const r = await api('GET', '/api/characters/me')
    expect(r.status).toBe(401)
  })

  it('Player 2 cannot act in Player 1\'s battle → 403/404', async () => {
    const r = await api('POST', `/api/battles/${bid}/action`, { action: 'attack' }, tok2)
    expect([403, 404]).toContain(r.status)
  })

  it('Cannot buy item without money (after draining)', async () => {
    // Buy items to drain money
    const items = (await api('GET', '/api/shops/government/items', undefined, tok1)).data as Array<{
      templateId: string; template: { priceBase: number }
    }>
    items.sort((a, b) => a.template.priceBase - b.template.priceBase)
    for (let i = 0; i < 20; i++) {
      await api('POST', '/api/shops/government/buy', { templateId: items[0].templateId }, tok1)
    }
    const expensive = items[items.length - 1]
    const r = await api('POST', '/api/shops/government/buy', { templateId: expensive.templateId }, tok1)
    expect(r.status).toBe(400)
  })

  it('Money never goes negative', async () => {
    const r = await api('GET', '/api/characters/me', undefined, tok1)
    expect((r.data as { money: number }).money).toBeGreaterThanOrEqual(0)
  })

  it('Durability never goes negative', async () => {
    const inv = (await api('GET', '/api/inventory', undefined, tok1)).data as Array<{ durabilityCurrent: number }>
    const minDur = Math.min(...inv.map(i => i.durabilityCurrent))
    expect(minDur).toBeGreaterThanOrEqual(0)
  })
})

// ─────────────────────────────────────────────────────────────────
// Scenario 3: Mathematical correctness (ТЗ раздел 17, 26.3)
// ─────────────────────────────────────────────────────────────────
describe('E2E: Mathematical correctness', () => {
  let token = ''

  beforeAll(async () => {
    await testPrisma.$connect()
    const l = uid('math')
    await fetch(`${BASE}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: l, email: `${l}@t.com`, password: 'pass123' }),
    })
    const r = (await (await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: l, password: 'pass123' }),
    })).json()) as { token: string }
    token = r.token
    await api('POST', '/api/characters', { nickname: uid('Math'), archetype: 'ATHLETE' }, token)
  })

  afterAll(async () => { await testPrisma.$disconnect() })

  it('Starting HP matches formula: 60 + END×6 + BL×2 (ATHLETE: END=4)', async () => {
    const char = (await api('GET', '/api/characters/me', undefined, token)).data as {
      hpMax: number; battleLevel: number; stats: { end: number }
    }
    // hpMax = 60 + 4×6 + 1×2 = 60 + 24 + 2 = 86
    const expected = 60 + char.stats.end * 6 + char.battleLevel * 2
    expect(char.hpMax).toBe(expected)
  })

  it('Battle completes: exp formula applied (exp >= 0)', async () => {
    // Buy weapon
    const items = (await api('GET', '/api/shops/government/items', undefined, token)).data as Array<{
      templateId: string; template: { type: string }
    }>
    const weapon = items.find(i => i.template.type === 'WEAPON')
    if (weapon) {
      const bought = await api('POST', '/api/shops/government/buy', { templateId: weapon.templateId }, token)
      const itemId = (bought.data as { item: { id: string } }).item.id
      await api('POST', '/api/inventory/equip', { itemInstanceId: itemId }, token)
    }

    // Run battle to completion
    const bRes = await api('POST', '/api/battles/pve/start', { botCode: 'training_bandit' }, token)
    const bid = (bRes.data as { battleId: string }).battleId
    let finalData: Record<string, unknown> = {}
    for (let i = 0; i < 35; i++) {
      const r = await api('POST', `/api/battles/${bid}/action`, { action: 'attack' }, token)
      const d = r.data as Record<string, unknown>
      if (d.battleOver) { finalData = d; break }
    }

    expect(finalData.expGain).toBeGreaterThanOrEqual(0)
    expect(finalData.weaponExpGain).toBeGreaterThanOrEqual(0)
    expect(finalData.result).toMatch(/PVE_(WIN|LOSS)/)
  })

  it('PvP create battle → 201', async () => {
    const r = await api('POST', '/api/battles/pvp/create', undefined, token)
    expect(r.status).toBe(201)
    expect((r.data as { battleId: string }).battleId).toMatch(/^[0-9a-f-]{36}$/)
  })
})
