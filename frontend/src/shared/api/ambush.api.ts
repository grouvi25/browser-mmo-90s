import { api } from './client'

export interface Pockets { binoculars: number; max: number; price: number }
export interface AmbushResult { success: boolean; chance: number; tier: 'CRITICAL' | 'COMA'; target: string }

export const ambushApi = {
  pockets: () => api.get<Pockets>('/api/ambush/pockets'),
  buyBinoculars: () => api.post<{ binoculars: number }>('/api/ambush/binoculars'),
  ambush: (targetId: string) => api.post<AmbushResult>('/api/ambush', { targetId }),
}
