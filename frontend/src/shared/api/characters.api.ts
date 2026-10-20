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
  clan?: { name: string; tag: string } | null
  createdAt?: string
}

export const charactersApi = {
  create: (data: { nickname: string; archetype: string; gender?: 'MALE' | 'FEMALE' }) =>
    api.post<Character>('/api/characters', data),

  setGender: (gender: 'MALE' | 'FEMALE') =>
    api.patch<{ gender: string }>('/api/characters/me/gender', { gender }),

  getMe: () =>
    api.get<Character>('/api/characters/me'),

  getById: (id: string) =>
    api.get<Character>(`/api/characters/${id}`),

  getByNickname: (nickname: string) =>
    api.get<PublicProfile>(`/api/characters/by-nickname/${encodeURIComponent(nickname)}`),
}
