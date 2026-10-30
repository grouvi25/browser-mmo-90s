import { api } from './client'
import type { ItemBonuses, ItemInstance, ItemStatKey } from '../types/api.types'

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

  /** Столбики именной вещи: весь расклад одним сохранением (правка 31.10). */
  configure: (itemInstanceId: string, own: Partial<Record<ItemStatKey, number>>, bonuses: ItemBonuses) =>
    api.post<{ itemId: string; freePoints: number; budget: number }>('/api/inventory/configure', { itemInstanceId, own, bonuses }),

  levelUp: (id: string) =>
    api.post<{ namedLevel: number; freePoints: number; dollars: number }>(`/api/inventory/items/${id}/level-up`, {}, { headers: { 'Idempotency-Key': crypto.randomUUID() } }),

  setIcon: (id: string, dataUrl: string) => api.put<{ iconVersion: number }>(`/api/inventory/items/${id}/icon`, { dataUrl }),
  iconUrl: (id: string, version: number) => `${(import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_API_BASE_URL || ''}/api/inventory/items/${id}/icon?v=${version}`,
}
