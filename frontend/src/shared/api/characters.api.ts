import { api } from './client'
import type { Character } from '../types/api.types'

export interface PublicProfile {
  hidden?: boolean
  id?: string
  nickname: string
  archetype?: string
  battleLevel?: number
  battlesTotal?: number
  battlesWon?: number
  location?: string | null
  createdAt?: string
}

export const charactersApi = {
  create: (data: { nickname: string; archetype: string }) =>
    api.post<Character>('/api/characters', data),

  getMe: () =>
    api.get<Character>('/api/characters/me'),

  getById: (id: string) =>
    api.get<Character>(`/api/characters/${id}`),

  getByNickname: (nickname: string) =>
    api.get<PublicProfile>(`/api/characters/by-nickname/${encodeURIComponent(nickname)}`),
}
