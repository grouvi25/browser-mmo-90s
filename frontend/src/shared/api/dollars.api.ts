import { api } from './client'

/** Игровые доллары: покупаются у дилера, тратятся на премиум и плюшки. */
export interface DollarMove {
  id: string
  amount: number
  balanceAfter: number
  reason: 'ISSUE' | 'WITHDRAW' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'PURCHASE'
  counterparty: string | null
  note: string | null
  createdAt: string
}

export const dollarsApi = {
  me: () => api.get<{ dollars: number; isDealer: boolean; history: DollarMove[] }>('/api/dollars/me'),
  dealers: () => api.get<{ items: { nickname: string; battleLevel: number; lastActiveAt: string }[] }>('/api/dollars/dealers'),
  transfer: (nickname: string, amount: number) =>
    api.post<{ to: string; amount: number; dealerBalance: number; targetBalance: number }>(
      '/api/dollars/transfer', { nickname, amount }, { headers: { 'Idempotency-Key': crypto.randomUUID() } }),
}
