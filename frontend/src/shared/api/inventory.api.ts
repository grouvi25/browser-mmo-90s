import { api } from './client'
import type { ItemInstance, ItemStatKey } from '../types/api.types'

export const inventoryApi = {
  getItems: () =>
    api.get<ItemInstance[]>('/api/inventory'),

  equip: (itemInstanceId: string) =>
    api.post<{ message: string; itemId: string }>('/api/inventory/equip', { itemInstanceId }),

  unequip: (itemInstanceId: string) =>
    api.post<{ message: string; itemId: string }>('/api/inventory/unequip', { itemInstanceId }),

  // Использовать расходник вне боя
  useItem: (itemInstanceId: string) =>
    api.post<{ hpRestored: number; newHp: number; itemName: string }>('/api/inventory/use-item', { itemInstanceId }),

  allocatePoints: (itemInstanceId: string, stat: ItemStatKey, points = 1) =>
    api.post<{ itemId: string; statAllocation: Partial<Record<ItemStatKey, number>>; freePoints: number }>('/api/inventory/allocate-points', { itemInstanceId, stat, points }),
}
