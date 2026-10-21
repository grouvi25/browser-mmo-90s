import { api } from './client'
import type { ItemTemplate } from '../types/api.types'
export interface CityLocation { path: string; jailedUntil: string | null; jailReason: string | null }
export interface Pet { id: string; code: string; name: string; food: number; fedUntil: string | null }
export interface DogEntry { code: string; name: string; role: string; price: number; priceDollars?: number; mainStat?: string; freeAllocation?: boolean; points: number }
export interface DogGearItem { code: string; slot: 'MUZZLE' | 'ARMOR' | 'COLLAR' | 'BOOTS'; name: string; price: number; bonus: Record<string, number> }
export interface DogState {
  id: string; code: string; name: string; role: string; fedUntil: string | null; fed: boolean
  level: number; exp: number; levelExp: number; nextLevelExp: number | null
  freeAllocation: boolean; freePoints: number; allocation: Record<string, number>
  gear: Record<string, { code: string; name: string; bonus: Record<string, number> } | null>
  fullBonus: Record<string, number>; bonus: Record<string, number>
}
export interface FeedPack { code: string; name: string; hours: number; price: number; currency: 'RUB' | 'USD' }
const paid = <T>(path: string, body: unknown) => api.post<T>(path, body, { headers: { 'Idempotency-Key': crypto.randomUUID() } })
export const cityApi = {
  location: () => api.get<CityLocation>('/api/city/location'),
  move: (path: string) => api.put('/api/city/location', { path }),
  professions: () => api.get<{ items: { code: string; name: string; price: number; owned: boolean; level: number }[] }>('/api/city/professions'),
  learn: (code: string) => paid('/api/city/professions', { code }),
  catalog: (kind: 'tsum' | 'berezka') => api.get<{ currency: 'USD'; items: Array<ItemTemplate & { priceDollars: number | null }> }>(`/api/city/shops/${kind}`),
  buy: (kind: 'tsum' | 'berezka', templateId: string) => paid(`/api/city/shops/${kind}/buy`, { templateId }),
  pets: () => api.get<{ catalog: DogEntry[]; packs: FeedPack[]; feedingHours: number; owned: Pet[]; dog: DogState | null; gear: DogGearItem[]; gearSlots: Record<string, string> }>('/api/city/pets'),
  dogGear: (petId: string, code: string) => paid('/api/city/pets/gear', { petId, code }),
  allocateDog: (petId: string, stat: string, delta: 1 | -1) => api.post('/api/city/pets/allocate', { petId, stat, delta }),
  buyPet: (code: string) => paid('/api/city/pets', { code }),
  exchangePet: (code: string) => paid('/api/city/pets/exchange', { code }),
  food: (petId: string, pack: string) => paid('/api/city/pets/food', { petId, pack }),
  feed: (petId: string) => paid('/api/city/pets/feed', { petId }),
}
