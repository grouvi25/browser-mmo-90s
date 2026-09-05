// =============================================================
// Городские объявления. Читать может любой вошедший — это доска, а не
// личная переписка; писать и снимать только администрация, и её ручки
// живут в админке, а не здесь.
// =============================================================
import { api } from './client'

export type AnnouncementKind = 'PATCH' | 'NEWS' | 'WORLD'

export interface Announcement {
  id: string
  kind: AnnouncementKind
  title: string
  body: string
  pinned: boolean
  authorLogin: string | null
  createdAt: string
}

export const announcementsApi = {
  feed: (kind?: AnnouncementKind, limit?: number) => {
    const query = new URLSearchParams()
    if (kind) query.set('kind', kind)
    if (limit) query.set('limit', String(limit))
    const tail = query.toString()
    return api.get<{ items: Announcement[] }>(`/api/announcements${tail ? `?${tail}` : ''}`)
  },
}
