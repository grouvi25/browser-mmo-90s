// =============================================================
// Эфир: лента, отправка, список онлайна.
//
// Комнату клана и общего канала сервер выбирает сам, поэтому scope
// отправляется только для района. Отказ антифлуда приходит кодом 429 —
// его разбирает вызывающий и показывает подсказкой, а не ошибкой.
// =============================================================
import { api } from './client'

export type ChatChannel = 'DISTRICT' | 'CLAN' | 'GLOBAL'

export interface ChatLine {
  id: string
  channel: ChatChannel
  scope: string
  authorId: string
  nickname: string
  level: number
  body: string
  createdAt: string
}

export interface ChatFeed {
  channel: ChatChannel
  scope: string
  limits: { maxBody: number; minGapMs: number }
  messages: ChatLine[]
}

export interface OnlinePlayer {
  characterId: string
  nickname: string
  level: number
}

export const chatApi = {
  feed: (channel: ChatChannel, scope?: string, limit?: number) => {
    const query = new URLSearchParams()
    if (scope) query.set('scope', scope)
    if (limit) query.set('limit', String(limit))
    const tail = query.toString()
    return api.get<ChatFeed>(`/api/chat/${channel.toLowerCase()}${tail ? `?${tail}` : ''}`)
  },

  send: (channel: ChatChannel, body: string, scope?: string) =>
    api.post<ChatLine>(`/api/chat/${channel.toLowerCase()}`, { body, scope }),

  online: () => api.get<{ players: OnlinePlayer[] }>('/api/chat/online/list'),
}
