import { api } from './client'
import type { Battle, LiveBattleState, BattleAction } from '../types/api.types'

interface StartPveResponse {
  battleId: string
  state: LiveBattleState
}

export type BodyZone = 'HEAD' | 'CHEST' | 'LEGS' | 'RIGHT_ARM' | 'LEFT_ARM'
export type Stance = 'attack2' | 'mixed' | 'defense4'

export interface GridPosition { x: number; y: number }

export interface SubmitActionOpts {
  itemInstanceId?: string
  stance?: Stance
  attackZones?: BodyZone[]
  blockZones?: BodyZone[]
  moveTo?: GridPosition
  targetParticipantId?: string
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
  botStance?: Stance
  botAttackZones?: BodyZone[]
  botBlockZones?: BodyZone[]
  distance?: number
  playerRange?: number
  turns?: Array<{
    actor: "player" | "enemy" | string
    action: string; hit: boolean; dodge: boolean; block: boolean
    crit: boolean; lucky?: boolean; blockPierced?: boolean; zone?: BodyZone
    counterDamage?: number
    rawDamage: number; finalDamage: number; logParts: string[]
  }>
}

export interface OpenDuel {
  battleId: string
  levelMin: number
  levelMax: number
  createdAt: string
  creator: { nickname: string; level: number; archetype: string } | null
  canJoin: boolean
}

export interface BattleHistoryItem {
  id: string
  type: string
  result: 'win' | 'lose' | 'draw'
  opponent: string
  opponentLevel: number
  expGain: number
  moneyGain: number
  rounds: number
  finishedAt: string | null
}

export interface BattleHistoryResponse {
  items: BattleHistoryItem[]
  total: number
  page: number
  limit: number
  pages: number
}

export const battlesApi = {
  startPve: (botCode = 'training_bandit') =>
    api.post<StartPveResponse>('/api/battles/pve/start', { botCode }),

  createPvpDuel: (levelMin?: number, levelMax?: number) =>
    api.post<{ battleId: string; status: string; levelMin: number; levelMax: number }>(
      '/api/battles/pvp/create',
      { levelMin, levelMax },
    ),

  listOpenDuels: () =>
    api.get<OpenDuel[]>('/api/battles/pvp/open'),

  acceptDuel: (battleId: string) =>
    api.post<{ battleId: string; status: string }>('/api/battles/pvp/accept', { battleId }),

  getBattleHistory: (page = 1, limit = 20) =>
    api.get<BattleHistoryResponse>(`/api/battles/me/history?page=${page}&limit=${limit}`),

  submitAction: (battleId: string, action: BattleAction, opts?: SubmitActionOpts) =>
    api.post<ActionResponse>(`/api/battles/${battleId}/action`, {
      action,
      itemInstanceId: opts?.itemInstanceId,
      stance: opts?.stance,
      attackZones: opts?.attackZones,
      blockZones: opts?.blockZones,
      moveTo: opts?.moveTo,
      targetParticipantId: opts?.targetParticipantId,
    }),

  getBattle: (battleId: string) =>
    api.get<{ battle: Battle; liveState: LiveBattleState | null }>(`/api/battles/${battleId}`),
}
