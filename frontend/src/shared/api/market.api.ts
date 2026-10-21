import { request } from './client'

export type Currency = 'RUB' | 'USD'
export interface TraderStatus { traderLevel: number; shopNumber: number | null; canSellResourcesForUsd: boolean; prices: { level1PriceRub: number; level2PriceUsd: number } }
export interface ShopOwner { id: string; nickname: string; traderLevel: number; shopNumber: number }

export interface MarketListingView {
  id: string
  type: 'ITEM' | 'RESOURCE'
  status: string
  itemInstanceId: string | null
  resourceTemplateId: string | null
  resourceAmount: number | null
  price: number
  currency?: Currency
  finalPrice?: number
  listingFee: number
  sellerCharacterId: string
  sellerNickname: string
  sellerUrl: string
  expiresAt: string
  item: { name: string; code: string; type: string; weaponType: string | null; levelReq: number; quality: string } | null
  resource: { name: string; code: string; tier: number } | null
}

export interface MarketFilters {
  mine?: boolean
  type?: 'ITEM' | 'RESOURCE'
  combat?: 'MELEE' | 'RANGED'
  level?: number
  search?: string
  priceMin?: number
  priceMax?: number
  sort?: 'NEWEST' | 'PRICE_ASC' | 'PRICE_DESC'
  page?: number
  limit?: number
}

export interface MarketListingsResponse {
  items: MarketListingView[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export const marketApi = {
  list: (filters: MarketFilters = {}) => {
    const query = new URLSearchParams()
    if (filters.mine) query.set('mine', 'true')
    if (filters.type) query.set('type', filters.type)
    if (filters.combat) query.set('combat', filters.combat)
    if (filters.level !== undefined) query.set('level', String(filters.level))
    if (filters.search) query.set('search', filters.search)
    if (filters.priceMin !== undefined) query.set('priceMin', String(filters.priceMin))
    if (filters.priceMax !== undefined) query.set('priceMax', String(filters.priceMax))
    if (filters.sort) query.set('sort', filters.sort)
    if (filters.page !== undefined) query.set('page', String(filters.page))
    if (filters.limit !== undefined) query.set('limit', String(filters.limit))
    return request<MarketListingsResponse>(`/api/market/listings?${query}`)
  },
  createItem: (itemInstanceId: string, price: number, currency: Currency = 'RUB') => request('/api/market/listings', { method: 'POST', body: { listingType: 'ITEM', itemInstanceId, price, currency }, headers: { 'Idempotency-Key': crypto.randomUUID() } }),
  createResource: (resourceTemplateId: string, amount: number, price: number, currency: Currency = 'RUB') => request('/api/market/listings', { method: 'POST', body: { listingType: 'RESOURCE', resourceTemplateId, amount, price, currency }, headers: { 'Idempotency-Key': crypto.randomUUID() } }),
  trader: () => request<TraderStatus>('/api/market/trader'),
  buyTraderLevel: (level: 1 | 2) => request<{ traderLevel: number; shopNumber: number }>('/api/market/trader', { method: 'POST', body: { level } }),
  shops: () => request<{ items: Array<ShopOwner & { listings: number }> }>('/api/market/shops'),
  shop: (shopNumber: number) => request<{ owner: ShopOwner; listings: MarketListingsResponse }>(`/api/market/shops/${shopNumber}`),
  buy: (id: string) => request(`/api/market/listings/${id}/buy`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } }),
  cancel: (id: string) => request(`/api/market/listings/${id}/cancel`, { method: 'POST' }),
}
