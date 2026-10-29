import { api } from './client'

const BASE = (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_API_BASE_URL || ''

export type SupportStatus = 'OPEN' | 'ANSWERED' | 'CLOSED'
export type SupportCategory = 'BUG' | 'PAYMENT' | 'ITEMS' | 'ACCOUNT' | 'COMPLAINT' | 'QUESTION' | 'IDEA' | 'OTHER'
export type SupportAuthor = 'PLAYER' | 'STAFF' | 'SYSTEM'

export const SUPPORT_CATEGORIES: [SupportCategory, string][] = [
  ['BUG', 'Ошибка в игре'],
  ['ITEMS', 'Вещи и деньги'],
  ['PAYMENT', 'Оплата и доллары'],
  ['ACCOUNT', 'Аккаунт и вход'],
  ['COMPLAINT', 'Жалоба на игрока'],
  ['QUESTION', 'Вопрос по игре'],
  ['IDEA', 'Предложение'],
  ['OTHER', 'Другое'],
]
export const CATEGORY_LABEL = Object.fromEntries(SUPPORT_CATEGORIES) as Record<SupportCategory, string>

export interface SupportTicketRow {
  id: string
  number: number
  subject: string
  category: SupportCategory
  status: SupportStatus
  lastMessageAt: string
  createdAt: string
  closedAt: string | null
  closedBy: string | null
  rating: number | null
  playerUnread: boolean
  last: { author: SupportAuthor; text: string } | null
}

export interface SupportMessage {
  id: string
  author: SupportAuthor
  authorLabel: string | null
  text: string
  hasImage: boolean
  createdAt: string
}

export interface SupportThread {
  ticket: Omit<SupportTicketRow, 'last'> & { canReopen: boolean }
  messages: SupportMessage[]
}

export const supportApi = {
  mine: () => api.get<{ items: SupportTicketRow[]; unread: number }>('/api/support'),
  unread: () => api.get<{ count: number }>('/api/support/unread'),
  create: (body: { subject: string; category: SupportCategory; text: string; image: string | null }) =>
    api.post<SupportTicketRow>('/api/support', body),
  thread: (id: string) => api.get<SupportThread>(`/api/support/${id}`),
  write: (id: string, text: string, image: string | null) => api.post<SupportThread>(`/api/support/${id}/messages`, { text, image }),
  close: (id: string) => api.post<SupportThread>(`/api/support/${id}/close`, {}),
  rate: (id: string, rating: number) => api.post<SupportThread>(`/api/support/${id}/rate`, { rating }),
  moderators: () => api.get<{ items: { nickname: string; level: number; online: boolean; lastActiveAt: string }[] }>('/api/support/moderators'),
  /** Скриншот по токену игрока: <img> заголовок не пошлёт, грузим fetch'ем. */
  image: async (ticketId: string, messageId: string) => {
    const token = localStorage.getItem('mmo_token')
    const res = await fetch(`${BASE}/api/support/${ticketId}/messages/${messageId}/image`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) throw new Error('Скриншот не загрузился')
    return URL.createObjectURL(await res.blob())
  },
}
