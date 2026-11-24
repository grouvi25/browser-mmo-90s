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
  reanimation: {
    floor: string | null
    self: { rubles: number; minutes: number } | null
    clinic: { dollars: number; minutes: number } | null
    aidUsed: number
  } | null
}

export interface BrigadePatient {
  id: string
  nickname: string
  title: string
  until: string
  level: string
  offer: { rubles: number; minutes: number } | null
  limit?: number
  used?: number
  reason: string | null
}

export interface HospitalStatus {
  injury: InjuryView | null
  brigade: { treasury: number; authority: number; level: string; debt: number; patients: BrigadePatient[] } | null
  prices: {
    hospital: { tier: InjuryTier; title: string; rubles: number; waitMinutes: number }[]
    clinic: { tier: InjuryTier; title: string; dollars: number }[]
  }
}

export const hospitalApi = {
  status: () => api.get<HospitalStatus>('/api/hospital'),
  treat: () => api.post<{ until: string }>('/api/hospital/treat'),
  clinic: () => api.post<{ healed: boolean }>('/api/hospital/clinic'),
  shorten: (channel: 'SELF' | 'CLINIC') => api.post<{ until: string }>('/api/hospital/shorten', { channel }),
  aid: (patientId: string) => api.post<{ until: string }>('/api/hospital/aid', { patientId }),
}
