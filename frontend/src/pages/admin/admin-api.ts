// =============================================================
// Клиент админки.
//
// Отдельный от игрового: у администратора СВОЙ токен и своя аутентификация
// (`/api/admin/auth/login`). Общий клиент шлёт игровой `mmo_token`, а
// админские ручки его не принимают — там проверяется `role: 'admin'`.
// Именно поэтому старая страница админки не работала ни разу: она ходила с
// игровым токеном и получала 401.
//
// Токен лежит в отдельном ключе. Смешивать их в одном нельзя: выход из игры
// не должен выкидывать из админки, и наоборот.
// =============================================================
const BASE = (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_API_BASE_URL || ''
const TOKEN_KEY = 'mmo_admin_token'
const ROLE_KEY = 'mmo_admin_role'

export type AdminRole = 'SUPER_ADMIN' | 'MODERATOR' | 'SUPPORT'

export const adminToken = {
  get: () => localStorage.getItem(TOKEN_KEY),
  role: () => localStorage.getItem(ROLE_KEY) as AdminRole | null,
  set(token: string, role: AdminRole) {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(ROLE_KEY, role)
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(ROLE_KEY)
  },
}

export class AdminApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message)
    this.name = 'AdminApiError'
  }
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = adminToken.get()
  const response = await fetch(`${BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    // Протухший или отозванный токен — выкидываем сразу, иначе экран
    // показывает пустые разделы и молчит о причине.
    if (response.status === 401) adminToken.clear()
    throw new AdminApiError(
      response.status,
      data?.code ?? 'UNKNOWN',
      data?.message ?? `Ошибка ${response.status}`,
    )
  }
  return data as T
}

// ── Типы ответов ─────────────────────────────────────────────

export interface ClanRow {
  id: string; name: string; tag: string; level: number
  treasury: number; authority: number
  territories: number; territoryLimit: number; members: number
  maintenanceDebt: number; isFrozen: boolean
}

export interface ClanCard {
  clan: {
    id: string; name: string; tag: string; treasury: number; authority: number
    territoryLimit: number; maintenanceDebt: number; isFrozen: boolean; upkeepPerDay: number
  }
  authorityAudit: { stored: number; fromLog: number; matches: boolean }
  members: { characterId: string; nickname: string | null; battleLevel: number | null; role: string; status: string }[]
  storage: { resourceCode: string; amount: number }[]
  territories: { code: string; name: string; status: string; upkeepTier: number; upkeepDebt: number; bonusSuspended: boolean }[]
  treasuryLog: { createdAt: string; amount: number; balanceAfter: number; reason: string }[]
  authorityLog: { createdAt: string; amount: number; balanceAfter: number; reason: string }[]
  openClaims: number
  attacksMade: number
}

export interface TerritoryRow {
  code: string; name: string; status: string
  owner: { clanId: string; name: string; tag: string } | null
  bonus: { code: string; value: number }
  upkeepTier: number; upkeepDebt: number; bonusSuspended: boolean
  protectedUntil: string | null; isProtected: boolean
  activeClaim: { id: string; status: string; attackerTag: string; defenderTag: string | null; battleStartsAt: string; battleId: string | null } | null
}

export interface ClaimRow {
  id: string
  territory: { code: string; name: string }
  status: string
  attacker: { tag: string; name: string }
  defender: { tag: string; name: string } | null
  battleStartsAt: string; battleId: string | null; walkover: boolean
  feePaid: number; authoritySpent: number
  roster: { attack: number; defence: number }
  createdAt: string
}

export interface ActionRow {
  id: string; adminId: string; adminRole: AdminRole
  kind: string; reason: string
  targetType: string; targetId: string
  undoKind: string
  rolledBackAt: string | null
  createdAt: string
}

export interface SignalRow {
  id: string; kind: string; status: string; severity: number
  userIds: string[]; summary: string; evidence: unknown
  createdAt: string
}

export interface LogEvent {
  at: string; source: string; action: string
  actor: { type: string; id: string } | null
  amount: number | null; balanceAfter: number | null
  ref: { type: string | null; id: string } | null
}

export interface TraceEvent {
  at: string; source: string; action: string
  amount: number | null; balanceAfter: number | null
  ref: { type: string | null; id: string } | null
  adminActionId: string | null
  details: unknown
}

/** Ежедневный снимок экономики — то, на чём дашборд строит динамику. */
export interface EconomySnapshot {
  date: string
  m2: number
  characters: number
  gini: number
  faucets: number
  sinks: number
  netEmission: number
  sinkShare: number
  m2Growth: number | null
  activeListings: number
  medianListingPrice: number
  completedShifts: number
  shiftReadyLagMedianSeconds: number | null
  tools: { usesConsumed: number; missingToolBlocks: number }
  upgrades: { total: number; successful: number; successRate: number }
  alerts: string[]
}

export interface EconomyOverview {
  m2Total: number
  characters: number
  activeListings: number
  activeShifts: number
  resources: { amount: number | null; reservedAmount: number | null }
  upgrades: { result: string; _count: number }[]
  latestMetrics: EconomySnapshot | null
}

export interface BalanceParam {
  path: string; value: unknown; note: string
  /** Что стоит в коде — чтобы отличить правку от исходного значения. */
  defaultValue?: unknown
  override?: { reason: string; updatedAt: string; adminId: string } | null
}

/** Разбор алерта: что случилось, на кого смотреть и что нажать. */
export interface AlertCard {
  code: string
  title: string
  severity: 'watch' | 'act'
  what: string
  why: string
  threshold: { path: string; limit: string; actual: string }
  evidenceTitle: string
  evidence: { label: string; value: string; characterId?: string }[]
  actions: { label: string; tab: string; focus?: string }[]
}

export interface PlayerRow {
  id: string; nickname: string; money: number
  battleLevel: number; economicLevel: number; createdAt: string
  user: { id: string; login: string; status: string; mutedUntil: string | null; lastLoginAt: string | null }
}
export interface BalanceExample {
  given: string[]
  steps: { text: string; value: string }[]
  result: string
  meaning: string
}
export interface BalanceFormula {
  id: string; title: string; formula: string; what: string; affects: string
  inputs: string[]; params: BalanceParam[]; source: string
  example?: BalanceExample
}
export interface BalanceGroup { id: string; title: string; intro: string; formulas: BalanceFormula[] }

/** Боец песочницы — те же поля, что принимает боевая ручка. */
export interface Fighter {
  name: string
  str: number; agi: number; rea: number; acc: number; end: number; luck: number; agr: number
  battleLevel: number; weaponSkill: number; antiSkill: number
  minDamage: number; maxDamage: number; weaponAccuracy: number
  armor: number; equipmentWeight: number
}

export interface CombatSide {
  name: string
  hp: number
  odds: {
    initiative: number; initiativeSpread: number
    hit: number; dodge: number; block: number; crit: number
    effectiveSkill: number; skillMultiplier: number
  }
  wins: number; winShare: number
  averageDamagePerSwing: number; landedShare: number
}

export interface CombatResult {
  a: CombatSide; b: CombatSide
  draws: number; duels: number; averageRounds: number
}

export interface ItemTemplateRow {
  code: string; name: string; type: string
  levelReq: number | null; priceBase: number | null
  minDamage: number | null; maxDamage: number | null; weaponAccuracy: number | null
  armor: number | null; durabilityMax: number | null; weight: number | null
}

// ── Ручки ────────────────────────────────────────────────────

export const adminApi = {
  async login(username: string, password: string) {
    const result = await request<{ token: string; adminId: string; role: AdminRole }>(
      '/api/admin/auth/login', { method: 'POST', body: { username, password } })
    adminToken.set(result.token, result.role)
    return result
  },

  stats: () => request<{ users: number; characters: number; battles: number; items: number }>('/api/admin/stats'),

  economyOverview: () => request<EconomyOverview>('/api/admin/economy/overview'),
  economyHistory: (days = 30) => request<{ items: EconomySnapshot[] }>(`/api/admin/economy/history?days=${days}`),
  balance: () => request<{ groups: BalanceGroup[]; overrides: unknown[] }>('/api/admin/balance'),
  alerts: () => request<{ cards: AlertCard[]; snapshotDate: string | null }>('/api/admin/alerts'),
  recheckAlerts: () => request<{ cards: AlertCard[]; snapshotDate: string }>('/api/admin/alerts/recheck', { method: 'POST' }),

  setBalanceParam: (path: string, value: unknown, reason: string) =>
    request<{ actionId: string; previous: unknown }>('/api/admin/balance/param', {
      method: 'PATCH', body: { path, value, reason },
    }),
  clearBalanceParam: (path: string, reason: string) =>
    request<{ actionId: string; restored: unknown }>('/api/admin/balance/param', {
      method: 'DELETE', body: { path, reason },
    }),

  players: (params: { search?: string; sort?: string } = {}) => {
    const query = new URLSearchParams()
    if (params.search) query.set('search', params.search)
    if (params.sort) query.set('sort', params.sort)
    return request<{ items: PlayerRow[] }>(`/api/admin/players?${query}`)
  },
  player: (id: string) => request<Record<string, unknown>>(`/api/admin/players/${id}`),
  banPlayer: (userId: string, reason: string) =>
    request<{ actionId: string }>(`/api/admin/players/${userId}/ban`, { method: 'POST', body: { reason } }),
  unbanPlayer: (userId: string, reason: string) =>
    request<{ actionId: string }>(`/api/admin/players/${userId}/unban`, { method: 'POST', body: { reason } }),
  mutePlayer: (userId: string, reason: string, hours: number) =>
    request<{ actionId: string }>(`/api/admin/players/${userId}/mute`, { method: 'POST', body: { reason, hours } }),

  updateItem: (code: string, fields: Record<string, unknown>, reason: string) =>
    request<{ actionId: string }>(`/api/admin/items/${code}`, { method: 'PATCH', body: { fields, reason } }),
  createItem: (item: Record<string, unknown>, reason: string) =>
    request<{ actionId: string; code: string }>('/api/admin/items', { method: 'POST', body: { item, reason } }),
  /** Та же симуляция, что на игровой ручке, но под админским токеном. */
  simulateBalance: <TIn, TOut>(input: TIn) =>
    request<TOut>('/api/admin/balance/simulate', { method: 'POST', body: input }),
  simulateCombat: (input: { a: Fighter; b: Fighter; duels: number; seed: number }) =>
    request<CombatResult>('/api/admin/sandbox/combat', { method: 'POST', body: input }),
  sandboxItems: () => request<{ items: ItemTemplateRow[] }>('/api/admin/sandbox/items'),

  clans: (query?: string) =>
    request<{ items: ClanRow[]; nextCursor: string | null }>(
      `/api/admin/clans${query ? `?query=${encodeURIComponent(query)}` : ''}`),
  clanCard: (id: string) => request<ClanCard>(`/api/admin/clans/${id}`),

  territories: () => request<{ items: TerritoryRow[] }>('/api/admin/territories'),

  claims: (status: 'open' | 'all') =>
    request<{ items: ClaimRow[]; nextCursor: string | null }>(`/api/admin/claims?status=${status}`),
  claimRoster: (id: string) =>
    request<{ claimId: string; status: string; roster: { side: number; nickname: string | null; battleLevelAtFiling: number; battleLevelNow: number | null }[] }>(
      `/api/admin/claims/${id}/roster`),

  actions: (params?: { targetType?: string; targetId?: string }) => {
    const query = new URLSearchParams()
    if (params?.targetType) query.set('targetType', params.targetType)
    if (params?.targetId) query.set('targetId', params.targetId)
    const suffix = query.toString()
    return request<{ items: ActionRow[]; nextCursor: string | null }>(
      `/api/admin/actions${suffix ? `?${suffix}` : ''}`)
  },
  rollback: (id: string, reason: string) =>
    request<{ actionId: string; rolledBackId: string }>(
      `/api/admin/actions/${id}/rollback`, { method: 'POST', body: { reason } }),

  signals: (status?: string) =>
    request<{ items: SignalRow[]; nextCursor: string | null }>(
      `/api/admin/abuse/signals${status ? `?status=${status}` : ''}`),
  reviewSignal: (id: string, status: 'REVIEWED' | 'DISMISSED', reason: string) =>
    request<{ actionId: string; status: string }>(
      `/api/admin/abuse/signals/${id}/review`, { method: 'POST', body: { status, reason } }),
  links: (userId: string) =>
    request<{ items: { userId: string; login: string | null; kind: string; weight: number; lastSeenAt: string }[] }>(
      `/api/admin/abuse/links?userId=${userId}`),

  logs: (params: { clanId?: string; characterId?: string; source?: string }) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value)
    return request<{ items: LogEvent[]; truncated: boolean }>(`/api/admin/logs?${query}`)
  },

  trace: (type: 'item' | 'character' | 'clan', id: string) =>
    request<{ subject: Record<string, unknown>; events: TraceEvent[]; truncated: boolean }>(
      `/api/admin/trace?type=${type}&id=${id}`),

  money: (characterId: string, amount: number, reason: string) =>
    request<{ actionId: string }>('/api/admin/characters/money', {
      method: 'POST', body: { characterId, amount, reason },
    }),

  resetTerritory: (code: string, reason: string) =>
    request<{ actionId: string }>(`/api/admin/territories/${code}/reset`, {
      method: 'POST', body: { reason },
    }),

  expireClaim: (id: string, reason: string) =>
    request<{ actionId: string }>(`/api/admin/claims/${id}/expire`, {
      method: 'POST', body: { reason },
    }),

  adjustAuthority: (clanId: string, amount: number, reason: string) =>
    request<{ actionId: string }>(`/api/admin/clans/${clanId}/authority`, {
      method: 'POST', body: { amount, reason },
    }),
}

/** Минимальная длина причины — то же число, что и на сервере. */
export const REASON_MIN = 10
