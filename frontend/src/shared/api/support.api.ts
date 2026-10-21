import { api } from './client'

export type SupportStatus = 'OPEN' | 'ANSWERED' | 'CLOSED'

export interface SupportTicket {
  id: string
  text: string
  status: SupportStatus
  reply: string | null
  repliedAt: string | null
  createdAt: string
  hasImage: boolean
}

export const supportApi = {
  mine: () => api.get<{ items: SupportTicket[] }>('/api/support'),
  create: (text: string, image: string | null) => api.post<SupportTicket>('/api/support', { text, image }),
}
