import { api } from './client'

export type PayoutStatus = 'PENDING' | 'PAID' | 'REJECTED'

export interface ReferralSummary {
  code: string
  sharePercent: number
  minPayout: number
  invited: number
  earned: number
  withdrawable: number
  payouts: { id: string; amount: number; status: PayoutStatus; adminNote: string | null; createdAt: string; processedAt: string | null }[]
}

export interface AdminPayout {
  id: string
  characterId: string
  nickname: string
  amount: number
  details: string
  status: PayoutStatus
  adminNote: string | null
  createdAt: string
  processedAt: string | null
}

export const referralApi = {
  me: () => api.get<ReferralSummary>('/api/referral/me'),
  requestPayout: (amount: number, details: string) =>
    api.post<{ id: string; amount: number; status: PayoutStatus }>(
      '/api/referral/payouts', { amount, details }, { headers: { 'Idempotency-Key': crypto.randomUUID() } }),
}
