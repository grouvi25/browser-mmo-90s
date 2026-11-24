// =============================================================
// Эфир: лента, отправка, список онлайна.
//
// Комнату клана и общего канала сервер выбирает сам, поэтому scope
// отправляется только для района. Отказ антифлуда приходит кодом 429 —
// его разбирает вызывающий и показывает подсказкой, а не ошибкой.
// =============================================================
import { api } from './client'

export type ChatChannel = 'DISTRICT' | 'CLAN' | 'GLOBAL' | 'PRIVATE'

export interface ChatLine {
  id: string
  channel: ChatChannel
  scope: string
  authorId: string
  nickname: string
  level: number
  body: string
  createdAt: string
  /** Строка от «Системы»: личное уведомление, видит только адресат. */
  system?: boolean
  /** Только у личных сообщений: кому написано. */
  recipientId?: string | null
  recipientNickname?: string | null
  /** Автор поправил реплику (№57). */
  editedAt?: string | null
}

export interface ChatFeed {
  channel: ChatChannel
  scope: string
  limits: { maxBody: number; minGapMs: number }
  messages: ChatLine[]
}

export interface ResidentProfile {
  occupation: string
  productionLevel: number
  stats: { str: number; agi: number; end: number; acc: number }
}

export interface OnlinePlayer {
  characterId: string
  nickname: string
  level: number
  resident?: ResidentProfile
  /** Бригада игрока с версией иконки (правка 21.10). */
  clan?: { id: string; name: string; iconVersion: number } | null
  /** Где стоит игрок: значок засады только у тех, кто рядом (травмы v8). */
  location?: string | null
}

export const chatApi = {
  feed: (channel: ChatChannel, scope?: string, limit?: number) => {
    const query = new URLSearchParams()
    if (scope) query.set('scope', scope)
    if (limit) query.set('limit', String(limit))
    const tail = query.toString()
    return api.get<ChatFeed>(`/api/chat/${channel.toLowerCase()}${tail ? `?${tail}` : ''}`)
  },

  send: (channel: ChatChannel, body: string, scope?: string, to?: string) =>
    api.post<ChatLine & { lines?: ChatLine[] }>(`/api/chat/${channel.toLowerCase()}`, { body, scope, to }),

  /** Модератор игры удаляет реплику из эфира. */
  remove: (id: string) => api.delete<{ removed: boolean }>(`/api/chat/messages/${id}`),
  edit: (id: string, body: string) => api.patch<ChatLine>(`/api/chat/messages/${id}`, { body }),
  report: (id: string, reason?: string) => api.post<{ reported: boolean }>(`/api/chat/messages/${id}/report`, { reason }),

  online: () => api.get<{ players: OnlinePlayer[] }>('/api/chat/online/list'),

  notices: (limit?: number) => api.get<{ items: Array<{ id: string; text: string; createdAt: string }> }>(`/api/chat/notices${limit ? `?limit=${limit}` : ''}`),
}
