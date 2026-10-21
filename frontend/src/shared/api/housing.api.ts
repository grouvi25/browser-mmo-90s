import { api } from './client'

export type HomeKind = 'APARTMENT' | 'HOUSE'
export type TunnelCode = 'pvp' | 'industrial' | 'farm'

export interface HousingView {
  prices: Record<HomeKind, { name: string; priceDollars: number; expBonus: number }>
  tunnelPrice: number
  repairPer10: number
  tunnels: { code: TunnelCode; label: string; where: string; to: string }[]
  wallet: { dollars: number; money: number }
  home: {
    id: string; kind: HomeKind; durability: number; tunnels: TunnelCode[]
    bonus: number; bonusActive: boolean
    raids: { at: string; attacker: string; won: boolean }[]
  } | null
  homes: { id: string; kind: HomeKind; durability: number; owner: string; ownerLevel: number; canRaidAt: string | null }[]
}

export const housingApi = {
  view: () => api.get<HousingView>('/api/housing'),
  buy: (kind: HomeKind) => api.post<{ cost: number; dollars: number }>('/api/housing/buy', { kind }),
  tunnel: (code: TunnelCode) => api.post<{ tunnels: TunnelCode[]; dollars: number }>('/api/housing/tunnels', { code }),
  repair: () => api.post<{ durability: number; cost: number }>('/api/housing/repair', {}),
  raid: (homeId: string) => api.post<{ battleId: string; guard: string; owner: string }>(`/api/housing/${homeId}/raid`, {}),
}
