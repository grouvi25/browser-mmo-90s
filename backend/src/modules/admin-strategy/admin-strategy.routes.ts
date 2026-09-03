// =============================================================
// АДМИНКА: маршруты разделов стратегического слоя — шаг G1 Этапа 5.
//
// Только чтение, доступно `SUPPORT`. Прозрачность между админами дешёвая и
// очень полезная: тот, кто разбирает жалобу, должен видеть всё, а ломать —
// ничего.
//
// Мутации разделов появятся на шаге G2 вместе с `AdminActionLog`.
// ТЗ: docs/specs/stage-5/STAGE5_ADMIN_API.md.
// =============================================================
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdminRole } from '../../shared/security/auth-middleware'
import { AdminStrategyService } from './admin-strategy.service'

const READ_ADMIN = { preHandler: requireAdminRole('SUPER_ADMIN', 'MODERATOR', 'SUPPORT') }

const Id = z.string().uuid()
const Limit = z.coerce.number().int().positive().max(500).optional()
const Cursor = z.string().uuid().optional()

/** 422 одной формой: маршруты не должны каждый раз собирать её заново. */
function invalid(reply: { code: (n: number) => { send: (body: unknown) => unknown } }) {
  return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
}

export async function adminStrategyRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Кланы ───────────────────────────────────────────────
  fastify.get('/clans', READ_ADMIN, async (req, reply) => {
    const parsed = z.object({
      query: z.string().trim().min(1).max(64).optional(),
      cursor: Cursor,
      limit: Limit,
    }).safeParse(req.query)
    if (!parsed.success) return invalid(reply)
    return reply.send(await AdminStrategyService.clans(parsed.data))
  })

  fastify.get<{ Params: { id: string } }>('/clans/:id', READ_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return invalid(reply)
    return reply.send(await AdminStrategyService.clanCard(req.params.id))
  })

  // ── Территории ──────────────────────────────────────────
  fastify.get('/territories', READ_ADMIN, async (_req, reply) => {
    return reply.send(await AdminStrategyService.territories())
  })

  // ── Заявки и войны ──────────────────────────────────────
  fastify.get('/claims', READ_ADMIN, async (req, reply) => {
    const parsed = z.object({
      status: z.enum(['open', 'all']).optional(),
      cursor: Cursor,
      limit: Limit,
    }).safeParse(req.query)
    if (!parsed.success) return invalid(reply)
    return reply.send(await AdminStrategyService.claims(parsed.data))
  })

  fastify.get<{ Params: { id: string } }>('/claims/:id/roster', READ_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return invalid(reply)
    return reply.send(await AdminStrategyService.claimRoster(req.params.id))
  })

  // ── Налёты на объекты ───────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/objects/:id/attacks', READ_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return invalid(reply)
    const parsed = z.object({ limit: Limit }).safeParse(req.query)
    if (!parsed.success) return invalid(reply)
    return reply.send(await AdminStrategyService.objectAttacks(req.params.id, parsed.data.limit))
  })

  // ── Premium и помощники ─────────────────────────────────
  fastify.get('/premium', READ_ADMIN, async (req, reply) => {
    const parsed = z.object({ characterId: Id }).safeParse(req.query)
    if (!parsed.success) return invalid(reply)
    return reply.send(await AdminStrategyService.premium(parsed.data.characterId))
  })

  // ── Единый поиск по журналам ────────────────────────────
  fastify.get('/logs', READ_ADMIN, async (req, reply) => {
    const parsed = z.object({
      source: z.enum(['all', 'currency', 'item', 'resource', 'production', 'treasury', 'authority']).optional(),
      characterId: Id.optional(),
      clanId: Id.optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      limit: Limit,
    }).safeParse(req.query)
    if (!parsed.success) return invalid(reply)
    // Персонаж и клан вместе бессмысленны: журналы персонажа и клана
    // разные, и запрос «и то и другое» вернул бы пустоту молча.
    if (parsed.data.characterId && parsed.data.clanId) return invalid(reply)
    return reply.send(await AdminStrategyService.logs(parsed.data))
  })
}
