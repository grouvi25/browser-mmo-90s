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
  gender: 'MALE' | 'FEMALE' | null
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

export type JournalKind = 'hit' | 'crit' | 'pierce' | 'dodge' | 'block' | 'move' | 'item' | 'weapon' | 'surrender'
export interface BattleJournalLine {
  id: string; round: number; at: string; actor: string; target: string | null
  side: number; kind: JournalKind; text: string
}
export interface BattleJournalPage {
  battle: { id: string; type: string; status: string; rounds: number; startedAt: string | null; finishedAt: string | null; winner: string | null }
  items: BattleJournalLine[]; page: number; pages: number; total: number
}

export interface BattleHistoryResponse {
  items: BattleHistoryItem[]
  total: number
  page: number
  limit: number
  pages: number
}


/** Заявка на бой: висит в общем списке до startsAt, потом бой открывается сам. */
export type ApplicationKind = 'DUEL' | 'GROUP' | 'CHAOTIC'
export interface ApplicationFighter { id: string | null; nickname: string; level: number }
export interface BattleApplication {
  battleId: string
  kind: ApplicationKind
  teamSize: number
  levelMin: number
  levelMax: number
  startsAt: string
  creator: ApplicationFighter
  isMine: boolean
  isCreator: boolean
  /** У хаотичной заявки одна общая сторона 0: стороны решает жребий на старте. */
  sides: Array<{ side: number; members: ApplicationFighter[] }>
  canJoin: Array<{ side: number; ok: boolean }>
}
export interface RunningBattle {
  battleId: string
  kind: ApplicationKind | 'SIEGE'
  startedAt: string | null
  sides: Array<{ side: number; members: ApplicationFighter[] }>
}
export interface ApplicationsResponse {
  serverTime: string
  applications: BattleApplication[]
  active: RunningBattle[]
}

export const battlesApi = {
  startPve: (botCode = 'training_bandit') =>
    api.post<StartPveResponse>('/api/battles/pve/start', { botCode }),

  listApplications: () =>
    api.get<ApplicationsResponse>('/api/battles/applications'),

  createApplication: (input: { kind: ApplicationKind; delayMinutes: number; teamSize?: number; levelMin?: number; levelMax?: number }) =>
    api.post<{ battleId: string; status: string; startsAt: string }>('/api/battles/applications', input),

  joinApplication: (battleId: string, side?: 1 | 2) =>
    api.post<{ battleId: string; side: number; started?: boolean }>(`/api/battles/applications/${battleId}/join`, side ? { side } : {}),

  leaveApplication: (battleId: string) =>
    api.post<{ battleId: string; cancelled: boolean }>(`/api/battles/applications/${battleId}/leave`, {}),

  current: () =>
    api.get<{ battleId: string | null; application: { battleId: string; startsAt: string } | null }>('/api/battles/me/current'),

  setHelperTactic: (battleId: string, tactic: 'ATTACK' | 'STANDARD' | 'DEFENSIVE') =>
    api.post<{ tactic: string }>(`/api/battles/${battleId}/helper-tactic`, { tactic }),

  getJournal: (battleId: string, page = 1) =>
    api.get<BattleJournalPage>(`/api/battles/${battleId}/journal?page=${page}`),

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
