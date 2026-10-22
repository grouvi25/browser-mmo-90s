import { api } from './client'

export type HomeKind = 'APARTMENT' | 'HOUSE'
export type TunnelCode = 'pvp' | 'industrial' | 'farm'

export interface RaidFighter { id: string; nickname: string; battleLevel: number }

/** Налёт на дом: заявка, бой ровно через 72 часа, до 10 на сторону. */
export interface HomeRaid {
  id: string
  status: 'PENDING' | 'IN_BATTLE'
  startsAt: string
  battleId: string | null
  attackers: RaidFighter[]
  /** Хозяин — первым: он в обороне всегда. */
  defenders: RaidFighter[]
  mySide: 1 | 2 | null
  canUnsign: boolean
  canEnterBattle: boolean
}

export interface HousingLot {
  lot: number
  kind: HomeKind
  label: string
  home: {
    id: string; durability: number; owner: string; ownerLevel: number; mine: boolean
    raid: HomeRaid | null
    /** Почему налёт сейчас не объявить, или null — можно. */
    raidBlocked: string | null
  } | null
}

export interface HousingView {
  prices: Record<HomeKind, { name: string; priceDollars: number; expBonus: number }>
  tunnelPrice: number
  /** Туннели роют только из этих видов жилья (из дома). */
  tunnelKinds: HomeKind[]
  /** Сколько ящиков склада у квартиры и у дома. */
  storageBoxes: Record<HomeKind, number>
  repairPer10: number
  tunnels: { code: TunnelCode; label: string; where: string; to: string }[]
  raidRules: { leadHours: number; maxPerSide: number; cooldownDays: number; durabilityLoss: number }
  wallet: { dollars: number; money: number }
  home: {
    id: string; kind: HomeKind; lot: number | null; label: string | null; durability: number; tunnels: TunnelCode[]
    bonus: number; bonusActive: boolean
    raid: HomeRaid | null
    raids: { at: string; attacker: string; won: boolean }[]
  } | null
  /** Участки сектора по порядку: 1…16 — квартиры, дальше дома. */
  lots: HousingLot[]
}

/** Склад жилья: дополнительные ящики, из центра их не видно. */
export interface HomeStorageView {
  boxes: number
  boxCapacity: number
  items: { code: string; name: string; amount: number }[]
}

export const housingApi = {
  storage: () => api.get<HomeStorageView>('/api/housing/storage'),
  storagePut: (code: string, amount: number) => api.post('/api/housing/storage/put', { code, amount }),
  storageTake: (code: string, amount: number) => api.post('/api/housing/storage/take', { code, amount }),
  view: () => api.get<HousingView>('/api/housing'),
  buy: (lot: number) => api.post<{ cost: number; dollars: number }>('/api/housing/buy', { lot }),
  tunnel: (code: TunnelCode) => api.post<{ tunnels: TunnelCode[]; dollars: number }>('/api/housing/tunnels', { code }),
  go: (code: TunnelCode) => api.post<{ to: string }>(`/api/housing/tunnels/${code}/go`, {}),
  exit: () => api.get<{ via: TunnelCode | null; area: string[] }>('/api/housing/exit'),
  returnHome: () => api.post<{ to: string }>('/api/housing/return', {}),
  repair: () => api.post<{ durability: number; cost: number }>('/api/housing/repair', {}),
  fileRaid: (homeId: string) => api.post<{ raidId: string; startsAt: string; owner: string }>(`/api/housing/${homeId}/raid`, {}),
  signupRaid: (raidId: string, side: 1 | 2) => api.post<{ side: number }>(`/api/housing/raids/${raidId}/signup`, { side }),
  unsignRaid: (raidId: string) => api.post(`/api/housing/raids/${raidId}/unsign`, {}),
}
