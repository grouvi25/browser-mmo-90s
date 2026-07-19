import { api } from './client'
import type { Battle, LiveBattleState, BattleAction } from '../types/api.types'

interface StartPveResponse {
  battleId: string
  state: LiveBattleState
}

interface ActionResponse {
  roundNumber?: number
  playerHp?: number
  botHp?: number
  battleOver?: boolean
  result?: string
  expGain?: number
  weaponExpGain?: number
  moneyReward?: number
  newLevel?: number
  waiting?: boolean
  turns?: Array<{
    actor: string
    action: string
    hit: boolean
    dodge: boolean
    block: boolean
    crit: boolean
    rawDamage: number
    finalDamage: number
    logParts: string[]
  }>
}

export const battlesApi = {
  startPve: (botCode = 'training_bandit') =>
    api.post<StartPveResponse>('/api/battles/pve/start', { botCode }),

  createPvpDuel: () =>
    api.post<{ battleId: string; status: string }>('/api/battles/pvp/create'),

  acceptDuel: (battleId: string) =>
    api.post<{ battleId: string; status: string }>('/api/battles/pvp/accept', { battleId }),

  submitAction: (battleId: string, action: BattleAction, itemInstanceId?: string) =>
    api.post<ActionResponse>(`/api/battles/${battleId}/action`, { action, itemInstanceId }),

  getBattle: (battleId: string) =>
    api.get<{ battle: Battle; liveState: LiveBattleState | null }>(`/api/battles/${battleId}`),
}
