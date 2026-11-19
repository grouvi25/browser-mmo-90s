// Разделы Библиотеки и Кодекса, которые администрация пишет в админке (Дима 19.11).
import { api } from './client'

export type ContentSection = 'LIBRARY' | 'CODEX'
export interface ContentPage { id: string; section: ContentSection; title: string; body: string; sortOrder: number; updatedAt: string }

export const contentApi = {
  list: (section: ContentSection) =>
    api.get<{ items: ContentPage[] }>(`/api/content/${section.toLowerCase()}`).then(r => r.items),
}
