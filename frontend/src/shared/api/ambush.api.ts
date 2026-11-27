import { api } from './client'

export interface Pockets { binoculars: number; max: number; price: number }
/** Засада — сразу дуэль (обращение №196). surprise — цель застигнута врасплох: первый раунд бьёте только вы. */
export interface AmbushResult { battleId: string; surprise: boolean; chance: number; target: string }

export const ambushApi = {
  pockets: () => api.get<Pockets>('/api/ambush/pockets'),
  buyBinoculars: () => api.post<{ binoculars: number }>('/api/ambush/binoculars'),
  ambush: (targetId: string) => api.post<AmbushResult>('/api/ambush', { targetId }),
}
