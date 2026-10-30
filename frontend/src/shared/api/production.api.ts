import { api } from './client'

const idem = () => ({ headers: { 'Idempotency-Key': crypto.randomUUID() } })

export interface ObjectCycle {
  id: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  laborAccumulated: number
  laborRequired: number
  startedAt?: string | null
  endsAt: string | null
  failureReason?: string | null
  outputQuality?: string | null
  recipe: { name: string; cycleMinutes?: number }
}

export interface ProductionObject {
  id: string
  code?: string
  name: string
  type: string
  status?: string
  ownerType: string
  ownerCharacterId: string | null
  purchasePrice: number | null
  /** Цена у государства в долларах — только на «Рынке объектов». */
  priceUsd?: number
  /** Сколько $ заплатил владелец; пусто — куплен за рубли до 28.10. */
  paidUsd?: number | null
  /** Объект бригады, которым игрок управляет по праву «Объекты» (28.10). */
  clanName?: string | null
  balance: number
  baseSalary?: number
  salaryOverride?: number | null
  durabilityCurrent: number
  durabilityMax: number
  storageCapacity: number
  activeRecipeId?: string | null
  profileSwitchEndsAt: string | null
  inventory: Array<{ resourceCode: string; resourceName?: string; quality: string; amount: number; reservedAmount: number }>
  cycles: ObjectCycle[]
  equipment?: { name: string; tier: number } | null
  /** Только в «Моих объектах»: что объект добывает, кто сейчас на смене, выплаты за сутки. */
  producesResourceName?: string | null
  workers?: Array<{ nickname: string; endsAt: string }>
  day?: { shifts: number; salaryPaid: number }
}

export interface ObjectRecipe {
  id: string
  code: string
  name: string
  outputResourceCode: string | null
  outputItemTemplateCode: string | null
  outputAmount: number
  cycleMinutes: number
  laborRequired: number
  requiredProfessionCode: string
  requiredProfessionLevel: number
  requiredToolTier: number
  requiredToolName?: string | null
  available: boolean
  missingLevel: number
  inputs: Array<{ resourceCode: string; resourceName?: string; amount: number; minQuality: string }>
  outputName?: string | null
  requiredProfessionName?: string
}

/** Цикл не стартовал: сервер возвращает причину, а не бросает ошибку. */
export type StartCycleResult =
  | { cycle: ObjectCycle }
  | { failure: string }
  | { alreadyRunning: true }

export const productionApi = {
  all: () => api.get<{ items: ProductionObject[] }>('/api/production/objects'),
  market: () => api.get<{ items: ProductionObject[] }>('/api/production/objects/market'),
  mine: () => api.get<{ items: ProductionObject[] }>('/api/production/objects/mine'),
  get: (id: string) => api.get<ProductionObject>(`/api/production/objects/${id}`),
  recipes: (objectCode: string) =>
    api.get<{ items: ObjectRecipe[] }>(`/api/production/recipes?objectCode=${encodeURIComponent(objectCode)}`),
  cycles: (id: string, limit = 20) =>
    api.get<{ items: ObjectCycle[] }>(`/api/production/objects/${id}/cycles?limit=${limit}`),

  buy: (id: string) => api.post(`/api/production/objects/${id}/buy`, undefined, idem()),
  sell: (id: string) => api.post<{ payout: number; currency: 'USD' | 'RUB' }>(`/api/production/objects/${id}/sell`, undefined, idem()),
  topup: (id: string, amount: number) => api.post(`/api/production/objects/${id}/balance`, { amount }, idem()),
  withdraw: (id: string, amount: number) => api.post(`/api/production/objects/${id}/withdraw`, { amount }, idem()),
  repair: (id: string) => api.post(`/api/production/objects/${id}/repair`, undefined, idem()),
  setSalary: (id: string, salary: number) => api.patch(`/api/production/objects/${id}/salary`, { salary }),
  switchProfile: (id: string, recipeId: string) =>
    api.post(`/api/production/objects/${id}/profile`, { recipeId }, idem()),
  startCycle: (id: string) => api.post<StartCycleResult>(`/api/production/objects/${id}/cycles/start`),
  stockTake: (id: string, resourceCode: string, amount: number) =>
    api.post(`/api/production/objects/${id}/stock/take`, { resourceCode, amount }, idem()),
  stockPut: (id: string, resourceCode: string, amount: number) =>
    api.post(`/api/production/objects/${id}/stock/put`, { resourceCode, amount }, idem()),
}
