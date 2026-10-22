import { api } from './client'
import type { ItemInstance, ItemStatKey } from '../types/api.types'

export const inventoryApi = {
  outfits: () => api.get<{ slots: number; items: { slot: number; name: string; count: number }[] }>('/api/inventory/outfits'),
  saveOutfit: (slot: number, name?: string) => api.post<{ slot: number; name: string; count: number }>(`/api/inventory/outfits/${slot}/save`, { name }),
  wearOutfit: (slot: number) => api.post<{ equipped: number; skipped: string[] }>(`/api/inventory/outfits/${slot}/wear`, {}),

  getItems: () =>
    api.get<ItemInstance[]>('/api/inventory'),

  equip: (itemInstanceId: string, hand?: 'LEFT_HAND' | 'RIGHT_HAND') =>
    api.post<{ message: string; itemId: string }>('/api/inventory/equip', { itemInstanceId, hand }),

  unequip: (itemInstanceId: string) =>
    api.post<{ message: string; itemId: string }>('/api/inventory/unequip', { itemInstanceId }),

  // Использовать расходник вне боя
  useItem: (itemInstanceId: string) =>
    api.post<{ hpRestored: number; newHp: number; itemName: string }>('/api/inventory/use-item', { itemInstanceId }),

  allocatePoints: (itemInstanceId: string, stat: ItemStatKey, points = 1) =>
    api.post<{ itemId: string; statAllocation: Partial<Record<ItemStatKey, number>>; freePoints: number }>('/api/inventory/allocate-points', { itemInstanceId, stat, points }),
}
