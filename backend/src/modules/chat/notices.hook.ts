// =============================================================
// Уведомления по каждому действию — одним перехватчиком на ответы.
//
// Заказчик: «чтобы уведомления по каждому действию в чате отображались
// (посадили, устроились, собрали, получили, купили и так далее)».
// Вместо правки десятка сервисов таблица ниже сопоставляет успешный
// ответ маршрута с текстом. Ответ читается только в случае успеха (2xx),
// сбой записи в журнал на действие не влияет.
// =============================================================
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../../shared/db/prisma'
import { CROPS, FARM_BUILDINGS, type CropCode, type FarmBuildingCode } from '../farm/farm.formulas'
import { NoticesService } from './notices.service'

type Body = Record<string, unknown>
const num = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('ru') : '')

interface Rule {
  method: string
  /** Шаблон маршрута Fastify, как он объявлен (с префиксом). */
  url: string
  text: (reqBody: Body, res: Body) => string | null
}

export const NOTICE_RULES: Rule[] = [
  { method: 'POST', url: '/api/farm/plots', text: () => 'Вы купили новый участок на ферме.' },
  { method: 'POST', url: '/api/farm/plots/:id/plant', text: b => `Вы посадили: ${CROPS[b.cropCode as CropCode]?.name ?? 'урожай'}.` },
  { method: 'POST', url: '/api/farm/plots/:id/water', text: () => 'Вы полили грядку.' },
  { method: 'POST', url: '/api/farm/plots/:id/harvest', text: (_b, r) => `Вы собрали урожай${typeof r.amount === 'number' ? `: ${r.amount} шт.` : ''}.` },
  { method: 'POST', url: '/api/farm/plots/:id/clear', text: () => 'Вы убрали засохший урожай, участок свободен.' },
  { method: 'POST', url: '/api/farm/plots/:id/building', text: b => `Вы построили: ${FARM_BUILDINGS[b.type as FarmBuildingCode]?.name ?? 'постройку'}.` },
  { method: 'POST', url: '/api/work/shifts/start', text: () => 'Вы вышли на смену.' },
  { method: 'POST', url: '/api/work/shifts/:shiftId/claim', text: (_b, r) => `Смена закрыта${r.salary ? `: получено ${num(r.salary)} ₽` : ''}.` },
  { method: 'POST', url: '/api/work/shifts/:shiftId/cancel', text: () => 'Вы отменили смену.' },
  { method: 'POST', url: '/api/city/professions', text: () => 'Вы изучили профессию в Училище.' },
  { method: 'POST', url: '/api/city/shops/:kind/buy', text: () => 'Вы купили вещь.' },
  { method: 'POST', url: '/api/city/pets', text: () => 'Вы купили собаку.' },
  { method: 'POST', url: '/api/city/pets/food', text: () => 'Вы купили корм.' },
  { method: 'POST', url: '/api/city/pets/feed', text: () => 'Вы покормили собаку.' },
  { method: 'POST', url: '/api/shops/government/buy', text: () => 'Вы купили товар в Госмагазине.' },
  { method: 'POST', url: '/api/shops/government/sell', text: () => 'Вы продали товар государству.' },
  { method: 'POST', url: '/api/private-shops/:shopCode/buy', text: () => 'Вы купили товар в частной лавке.' },
  { method: 'POST', url: '/api/resources/sell', text: () => 'Вы продали ресурсы.' },
  { method: 'POST', url: '/api/market/listings', text: () => 'Вы выставили лот на рынок.' },
  { method: 'POST', url: '/api/market/listings/:listingId/buy', text: () => 'Вы купили лот на рынке.' },
  { method: 'POST', url: '/api/market/listings/:listingId/cancel', text: () => 'Вы сняли лот с рынка.' },
  { method: 'POST', url: '/api/repair/commit', text: () => 'Вы отремонтировали вещь.' },
  { method: 'POST', url: '/api/upgrades/commit', text: () => 'Вы улучшили вещь.' },
  { method: 'POST', url: '/api/premium/buy', text: () => 'Вы купили подписку за доллары.' },
  { method: 'POST', url: '/api/dollars/transfer', text: (b, r) => `Вы зачислили ${num(b.amount)} $ игроку ${String(r.to ?? '')}.` },
  { method: 'POST', url: '/api/clans/house/repair', text: (_b, r) => `Вы починили дом бригады${r.cost ? ` за ${num(r.cost)} ₽` : ''}.` },
]

function parse(payload: unknown): Body {
  try { return typeof payload === 'string' ? (JSON.parse(payload) as Body) : {} } catch { return {} }
}

export function registerNoticeHook(app: FastifyInstance): void {
  const byKey = new Map(NOTICE_RULES.map(rule => [`${rule.method} ${rule.url}`, rule]))
  app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload) => {
    if (reply.statusCode < 200 || reply.statusCode >= 300) return payload
    const rule = byKey.get(`${req.method} ${req.routeOptions?.url ?? ''}`)
    const userId = (req as { authUser?: { userId?: string } }).authUser?.userId
    if (!rule || !userId) return payload
    const text = rule.text((req.body ?? {}) as Body, parse(payload))
    if (!text) return payload
    // Не ждём запись: ответ игроку не должен задерживаться из-за журнала.
    void prisma.character.findUnique({ where: { userId }, select: { id: true } })
      .then(c => (c ? NoticesService.push(c.id, text) : undefined))
      .catch(() => undefined)
    return payload
  })
}
