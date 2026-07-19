import { api } from './client'
import type { Character } from '../types/api.types'

export const charactersApi = {
  create: (data: { nickname: string; archetype: string }) =>
    api.post<Character>('/api/characters', data),

  getMe: () =>
    api.get<Character>('/api/characters/me'),

  getById: (id: string) =>
    api.get<Character>(`/api/characters/${id}`),
}
