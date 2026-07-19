import { api } from './client'
import type { ItemInstance } from '../types/api.types'

export const inventoryApi = {
  getItems: () =>
    api.get<ItemInstance[]>('/api/inventory'),

  equip: (itemInstanceId: string) =>
    api.post<{ message: string; itemId: string }>('/api/inventory/equip', { itemInstanceId }),

  unequip: (itemInstanceId: string) =>
    api.post<{ message: string; itemId: string }>('/api/inventory/unequip', { itemInstanceId }),
}
