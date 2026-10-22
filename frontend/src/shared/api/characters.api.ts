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
  clan?: { id: string; name: string; iconVersion?: number } | null
  createdAt?: string
  gender?: 'MALE' | 'FEMALE'
  economicLevel?: number
  hpCurrent?: number
  hpMax?: number
  professions?: Array<{ professionCode: string; level: number; name: string }>
  weaponSkills?: Array<{ weaponType: string; skillLevel: number }>
  dog?: Character['dog']
  weapons?: Array<{ armorSlot: string | null; name: string; code: string; weaponType: string | null }>
}

export const charactersApi = {
  creationConfig: () => api.get<{ startMoney: number }>('/api/characters/creation-config'),

  create: (data: { nickname: string; archetype: string; gender?: 'MALE' | 'FEMALE' }) =>
    api.post<Character>('/api/characters', data),

  setGender: (gender: 'MALE' | 'FEMALE') =>
    api.patch<{ gender: string }>('/api/characters/me/gender', { gender }),

  getMe: () =>
    api.get<Character>('/api/characters/me'),

  getBattleLoadout: () =>
    api.get<{ itemInstanceIds: string[] }>('/api/characters/me/battle-loadout'),

  setBattleLoadout: (itemInstanceIds: string[]) =>
    api.put<{ itemInstanceIds: string[] }>('/api/characters/me/battle-loadout', { itemInstanceIds }),

  getById: (id: string) =>
    api.get<Character>(`/api/characters/${id}`),

  note: (targetId: string) => api.get<{ text: string }>(`/api/characters/notes/${targetId}`),
  saveNote: (targetId: string, text: string) => api.put<{ ok: true }>(`/api/characters/notes/${targetId}`, { text }),

  getByNickname: (nickname: string) =>
    api.get<PublicProfile>(`/api/characters/by-nickname/${encodeURIComponent(nickname)}`),
}
