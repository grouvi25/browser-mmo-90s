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
  farmPlots?: number
  farmCrop?: CropCode
  farmChecksPerDay?: number
  cropPrice?: number
}

export type CropCode = 'dill' | 'potato' | 'hops' | 'sunflower' | 'tobacco'

/** Именованная статья дохода или расхода: сумма без названия ничего не
 *  чинит — по ней не понять, что именно крутить. */
export interface LedgerLine {
  label: string
  perDay: number
  /** Формула в разделе «Баланс», которой статья управляется. */
  formula: string
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
  faucets: LedgerLine[]
  sinks: LedgerLine[]
  timeline: Array<{ day: number; money: number }>
}

export interface SandboxResult {
  meta: {
    source: string
    generatedAt: string
    limits: { shifts: number; minutes: number }
    targets: { minSinkShare: number; maxDailyM2Growth: number }
    farm: { plots: number; crop: CropCode; cycles: number }
    crops: { code: CropCode; name: string; minutes: number; seedPrice: number }[]
  }
  input: SandboxInput
  rows: SandboxRow[]
  sensitivity: {
    key: string; label: string; current: number
    sinkShareUp: number; sinkShareDown: number; impact: number
  }[]
  verdicts: { profileParity: boolean; sinkHealth: boolean; m2Growth: boolean; nonNegative: boolean }
  recommendations: string[]
  totals: { sinkShare: number; minted: number; burned: number; dailyM2Growth: number; finalM2: number }
}

export const balanceSandboxApi = {
  simulate: (input: SandboxInput) => api.post<SandboxResult>('/api/balance-sandbox/simulate', input),
}
