import { api } from './client'
import type { InjuryTier } from '../types/api.types'

export interface InjuryView {
  tier: InjuryTier
  title: string
  until: string
  treated: boolean
  blocksCombat: boolean
  penaltyPercent: number
  expMultiplier: number
  hospital: { rubles: number; waitMinutes: number } | null
  clinic: { dollars: number } | null
}

export interface HospitalStatus {
  injury: InjuryView | null
  prices: {
    hospital: { tier: InjuryTier; title: string; rubles: number; waitMinutes: number }[]
    clinic: { tier: InjuryTier; title: string; dollars: number }[]
  }
}

export const hospitalApi = {
  status: () => api.get<HospitalStatus>('/api/hospital'),
  treat: () => api.post<{ until: string }>('/api/hospital/treat'),
  clinic: () => api.post<{ healed: boolean }>('/api/hospital/clinic'),
}
