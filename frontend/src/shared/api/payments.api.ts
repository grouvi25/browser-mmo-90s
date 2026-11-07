import { api } from './client'

/** Покупка долларов картой или СБП (эквайринг Т-Банка). */
export type PaymentStatus = 'NEW' | 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELED' | 'REFUNDED'
export interface PaymentOffer { enabled: boolean; priceKopecks: number; packs: { dollars: number; amountKopecks: number }[] }
export interface MyPayment { id: string; dollars: number; amountKopecks: number; status: PaymentStatus; createdAt: string; confirmedAt: string | null }

export const paymentsApi = {
  offer: () => api.get<PaymentOffer>('/api/payments/offer'),
  start: (dollars: number) => api.post<{ paymentId: string; paymentUrl: string }>('/api/payments', { dollars }),
  mine: () => api.get<{ items: MyPayment[] }>('/api/payments/mine'),
}

/** Копейки в рубли для экрана: 120000 → «1 200 ₽». */
export const rub = (kopecks: number) => `${(kopecks / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`
