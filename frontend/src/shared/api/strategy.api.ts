// =============================================================
// Клиент стратегического слоя — Этап 4.
//
// Территории, заявки, налёты на объекты, премиум и помощники.
// Все причины отказа сервер отдаёт словами: в стратегическом слое отказ —
// половина игры, и клиент не должен ничего вычислять сам. Поэтому
// blockedReason приходит с сервера, а не считается здесь.
// =============================================================
import { api } from './client'

const idem = () => ({ headers: { 'Idempotency-Key': crypto.randomUUID() } })

// ── Территории ───────────────────────────────────────────────
export type TerritoryStatus = 'NEUTRAL' | 'CONTROLLED' | 'CONTESTED' | 'UNDER_ATTACK' | 'PROTECTED'

export type ClaimBlockedReason =
  | 'NO_PERMISSION' | 'NO_CLAN' | 'PROTECTED' | 'CONTESTED' | 'LIMIT_REACHED'
  | 'NOT_ENOUGH_AUTHORITY' | 'NOT_ENOUGH_MONEY' | 'CLAN_COOLDOWN' | 'ALLY_OWNED'

export interface TerritoryRow {
  code: string
  name: string
  status: TerritoryStatus
  owner: { clanId: string; name: string; tag: string } | null
  bonus: { code: string; value: number; text: string }
  objectCount: number
  protectedUntil: string | null
  activeClaim: { id: string; attackerTag: string; battleStartsAt: string } | null
  myClan: { canClaim: boolean; blockedReason: ClaimBlockedReason | null }
}

export interface TerritoryCard extends TerritoryRow {
  upkeep?: { tier: number; perDay: number; debt: number; bonusSuspended: boolean }
  objects: { id: string; name: string; type: string; ownerTag: string | null; status: string }[]
  history: { at: string; event: string; clanTag: string }[]
}

export interface ClaimView {
  id: string
  status: 'PENDING' | 'BATTLE' | 'WON' | 'LOST' | 'CANCELLED' | 'EXPIRED'
  battleStartsAt: string
  battleId: string | null
  walkover: boolean
  attacker: { clanTag: string; roster: { nickname: string; battleLevel: number }[] }
  defender: { clanTag: string; roster: { nickname: string; battleLevel: number }[] } | null
}

export const territoriesApi = {
  list: () => api.get<{ items: TerritoryRow[] }>('/api/territories'),
  card: (code: string) => api.get<TerritoryCard>(`/api/territories/${code}`),
  claim: (code: string, roster: string[]) =>
    api.post<{ claim: ClaimView }>(`/api/territories/${code}/claims`, { roster }, idem()),
  defence: (code: string, claimId: string, roster: string[]) =>
    api.post<{ roster: unknown[] }>(`/api/territories/${code}/claims/${claimId}/defence`, { roster }, idem()),
  claimView: (code: string, claimId: string) =>
    api.get<ClaimView>(`/api/territories/${code}/claims/${claimId}`),
  cancelClaim: (code: string, claimId: string) =>
    api.delete<{ status: string; feeRefunded: boolean }>(`/api/territories/${code}/claims/${claimId}`),
  clanTerritories: (clanId: string) =>
    api.get<{ items: TerritoryRow[]; limit: number; upkeepPerDay: number; totalDebt: number }>(
      `/api/clans/${clanId}/territories`),
  clanWars: (clanId: string) =>
    api.get<{ items: { at: string; territoryCode: string; role: 'ATTACK' | 'DEFENCE'; result: string; authorityDelta: number; battleId: string | null }[] }>(
      `/api/clans/${clanId}/wars`),
  authority: (clanId: string) =>
    api.get<{ current: number; log: { at: string; amount: number; reason: string; balanceAfter: number }[] }>(
      `/api/clans/${clanId}/authority`),
}

// ── Налёты на объекты ────────────────────────────────────────
export type AttackBlockedReason =
  | 'NO_CLAN' | 'NO_PERMISSION' | 'COOLDOWN' | 'NOT_AT_WAR'
  | 'OWNER_SOLO' | 'TOO_POOR' | 'NO_AUTHORITY' | 'OWN_OBJECT'

export interface AttackTarget {
  objectId: string
  name: string
  type: string
  districtCode: string | null
  status: string
  /** Полосой, а не суммой: точный баланс чужого объекта — разведка. */
  balanceBand: 'LOW' | 'NORMAL' | 'HIGH'
  cooldownUntil: string | null
  canSabotage: boolean
  canRob: boolean
  blockedReason: AttackBlockedReason | 'TOO_POOR' | null
}

export const objectWarApi = {
  attackable: () =>
    api.get<{ items: AttackTarget[]; blockedReason?: string }>('/api/objects/attackable'),
  sabotage: (id: string) =>
    api.post<{ durabilityLost: number; newDurability: number; status: string; cancelledCycleId: string | null; authoritySpent: number }>(
      `/api/objects/${id}/sabotage`, {}, idem()),
  rob: (id: string) =>
    api.post<{ moneyTaken: number; treasuryAfter: number; authoritySpent: number }>(
      `/api/objects/${id}/rob`, {}, idem()),
  history: (id: string) =>
    api.get<{ items: { at: string; type: string; attackerTag: string; durabilityLost: number; moneyTaken: number }[] }>(
      `/api/objects/${id}/attacks`),
  transferPreview: (id: string) =>
    api.get<{ objectName: string; balanceMovedToTreasury: number; clanObjects: number; clanObjectLimit: number; territories: number; irreversible: true; canTransfer: boolean }>(
      `/api/objects/${id}/transfer-preview`),
  transferToClan: (id: string) =>
    api.post<{ objectId: string; clanId: string; balanceMoved: number; treasuryAfter: number; limit: number }>(
      `/api/objects/${id}/transfer-to-clan`, {}, idem()),
}

// ── Premium ──────────────────────────────────────────────────
export interface PremiumState {
  isPremium: boolean
  expiresAt: string | null
  benefits: { skillMultiplier: number; helperSlots: number; dailyShiftCap: number; loadoutSlots: number }
}

export interface PremiumProduct {
  code: string
  name: string
  description: string
  kind: 'TIME' | 'COSMETIC' | 'CONVENIENCE'
  priceRub: number
  grantCode: string
}

export const premiumApi = {
  me: () => api.get<PremiumState>('/api/premium/me'),
  shop: () => api.get<{ items: PremiumProduct[] }>('/api/premium/shop'),
  purchases: () =>
    api.get<{ items: { at: string; code: string; name: string; kind: string; priceRub: number }[] }>(
      '/api/premium/purchases'),
}

// ── Помощники ────────────────────────────────────────────────
export interface Helper {
  id: string
  name: string
  status: 'ACTIVE' | 'DORMANT'
  professionCode: string
  professionLevel: number
  professionExp: number
  skillCap: number
  activeShift: { id: string; productionObjectId: string; endsAt: string; status: string } | null
}

export const helpersApi = {
  list: () => api.get<{ items: Helper[]; slots: { used: number; total: number } }>('/api/helpers'),
  hire: (name: string, professionCode: string) =>
    api.post<Helper>('/api/helpers', { name, professionCode }, idem()),
  dismiss: (id: string) => api.delete<{ dismissed: string }>(`/api/helpers/${id}`),
  work: (id: string, objectId: string) =>
    api.post<{ shiftId: string; endsAt: string; baseSalary: number }>(
      `/api/helpers/${id}/work`, { objectId }, idem()),
  claim: (id: string) =>
    api.post<{ shiftId: string; salary: number; newBalance: number; helper: { professionExp: number; professionLevel: number } }>(
      `/api/helpers/${id}/claim`, {}, idem()),
}
