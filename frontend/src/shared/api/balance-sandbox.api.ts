import { api } from './client'

export interface SandboxInput {
  days: number
  players: number
  salary: number
  battleReward: number
  repairCost: number
  marketPrice: number
  shiftMinutes: number
  winRate: number
}

export interface SandboxRow {
  profile: 'fighter' | 'worker' | 'mixed'
  money: number
  netPerDay: number
  minted: number
  burned: number
  sinkShare: number
  shiftsPerDay: number
  minutesPerDay: number
  timeline: Array<{ day: number; money: number }>
}

export interface SandboxResult {
  meta: {
    source: string
    generatedAt: string
    limits: { shifts: number; minutes: number }
    targets: { minSinkShare: number; maxDailyM2Growth: number }
  }
  input: SandboxInput
  rows: SandboxRow[]
  verdicts: { profileParity: boolean; sinkHealth: boolean; m2Growth: boolean; nonNegative: boolean }
  recommendations: string[]
  totals: { sinkShare: number; minted: number; burned: number; dailyM2Growth: number; finalM2: number }
}

export const balanceSandboxApi = {
  simulate: (input: SandboxInput) => api.post<SandboxResult>('/api/balance-sandbox/simulate', input),
}
