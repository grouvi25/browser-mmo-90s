import { api } from './client'
import type { Battle, LiveBattleState, BattleAction } from '../types/api.types'

interface StartPveResponse {
  battleId: string
  state: LiveBattleState
}

// Ноги разведены на левую и правую, как руки: так они нарисованы в
// макете боевого экрана. LEGS остаётся только ради истории — сервер
// его больше не принимает, но старые бои им подписаны.
export type BodyZone =
  | 'HEAD' | 'CHEST' | 'RIGHT_ARM' | 'LEFT_ARM' | 'RIGHT_LEG' | 'LEFT_LEG'
  | 'LEGS'
export type AttackHand = 'LEFT_HAND' | 'RIGHT_HAND'
export type Stance = 'attack2' | 'mixed' | 'defense4'

export interface GridPosition { x: number; y: number }

export interface BattleParticipantProfile {
  participantId: string
  name: string
  level: number
  avatar: string | null
  primaryHand: string | null
  secondaryHand: string | null
  primaryWeaponCode: string | null
  secondaryWeaponCode: string | null
  primaryWeaponType: string | null
  secondaryWeaponType: string | null
  primaryRange: number
  secondaryRange: number
  stats: { str: number; agi: number; rea: number; acc: number; end: number; luck: number; agr: number } | null
}

export interface SubmitActionOpts {
  itemInstanceId?: string
  weaponHand?: AttackHand
  stance?: Stance
  attackZones?: BodyZone[]
  attackHands?: AttackHand[]
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
    sourceHand?: AttackHand
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


/** Командный бой: открытый набор состава. */
export interface TeamBattleMember { id: string; nickname: string; battleLevel: number }
export interface TeamBattleLobby {
  battleId: string
  perSide: number
  levelMin: number
  levelMax: number
  sides: Array<{ side: number; members: TeamBattleMember[] }>
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


  createTeamBattle: (perSide: number) =>
    api.post<{ battleId: string; status: string; perSide: number; side: number }>(
      '/api/battles/team/create', { perSide },
    ),

  listTeamBattles: () =>
    api.get<{ items: TeamBattleLobby[] }>('/api/battles/team/open'),

  joinTeamBattle: (battleId: string, side: 1 | 2) =>
    api.post<{ battleId: string; side: number; joined: number; perSide: number }>(
      '/api/battles/team/join', { battleId, side },
    ),

  startTeamBattle: (battleId: string) =>
    api.post<{ battleId: string; status: string; participants: number }>(
      '/api/battles/team/start', { battleId },
    ),

  getBattleHistory: (page = 1, limit = 20) =>
    api.get<BattleHistoryResponse>(`/api/battles/me/history?page=${page}&limit=${limit}`),

  submitAction: (battleId: string, action: BattleAction, opts?: SubmitActionOpts) =>
    api.post<ActionResponse>(`/api/battles/${battleId}/action`, {
      action,
      itemInstanceId: opts?.itemInstanceId,
      weaponHand: opts?.weaponHand,
      stance: opts?.stance,
      attackZones: opts?.attackZones,
      attackHands: opts?.attackHands,
      blockZones: opts?.blockZones,
      moveTo: opts?.moveTo,
      targetParticipantId: opts?.targetParticipantId,
    }),

  getBattle: (battleId: string) =>
    api.get<{ battle: Battle; liveState: LiveBattleState | null; participantProfiles: BattleParticipantProfile[] }>(`/api/battles/${battleId}`),
}
