import { api } from './client'
import type { ShopItem, ItemInstance } from '../types/api.types'

export const shopApi = {
  listItems: () =>
    api.get<ShopItem[]>('/api/shops/government/items'),

  buy: (templateId: string) =>
    api.post<{ item: ItemInstance; newBalance: number }>('/api/shops/government/buy', { templateId },
      { headers: { 'Idempotency-Key': crypto.randomUUID() } }),

  sell: (itemInstanceId: string) =>
    api.post<{ sellPrice: number; newBalance: number }>('/api/shops/government/sell', { itemInstanceId }),

  discard: (itemInstanceId: string) =>
    api.post<{ success: boolean }>('/api/shops/government/discard', { itemInstanceId }),
}
