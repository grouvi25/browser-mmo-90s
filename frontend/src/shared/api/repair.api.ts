import { api } from './client'
import type { RepairItem } from '../types/api.types'

interface RepairPreview {
  item: RepairItem
  durabilityCurrent: number
  durabilityMax: number
  lostDurability: number
  repairCost: number
  canAfford: boolean
  characterMoney: number
  itemTier: number
  upgradeLevel: number
  needsParts: boolean
  requiredParts: { resourceCode: string; resourceName: string; amount: number; available: number; enough: boolean }[]
  partsEnough: boolean
  canRepair: boolean
}

interface RepairResult {
  itemId: string
  durabilityAfter: number
  cost: number
  newBalance: number
}

export const repairApi = {
  listItems: () =>
    api.get<RepairItem[]>('/api/repair/items'),

  preview: (itemInstanceId: string) =>
    api.post<RepairPreview>('/api/repair/preview', { itemInstanceId }),

  commit: (itemInstanceId: string) =>
    api.post<RepairResult>('/api/repair/commit', { itemInstanceId }),
}
