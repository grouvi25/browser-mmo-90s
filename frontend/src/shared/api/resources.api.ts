import { request } from './client'

export interface ResourceStackView {
  id: string
  amount: number
  reservedAmount: number
  availableAmount: number
  template: { code: string; name: string; tier: number; basePrice: number; weight: number; category: string }
}
export interface ResourcesResponse { items: ResourceStackView[]; totalWeight: number }

export const resourcesApi = {
  list: () => request<ResourcesResponse>('/api/resources'),
  sell: (resourceCode: string, amount: number) => request<{ payout: number; newBalance: number }>('/api/resources/sell', {
    method: 'POST', body: { resourceCode, amount }, headers: { 'Idempotency-Key': crypto.randomUUID() },
  }),
}
