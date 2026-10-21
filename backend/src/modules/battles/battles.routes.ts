import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../shared/security/auth-middleware'
import { BattleService } from './battles.service'
import { BattleJournal } from './battle-journal'
import { ApplicationsService, APPLICATION_DELAYS, APPLICATION_MAX_TEAM } from './applications.service'
import { z } from 'zod'

const StartPveSchema = z.object({ botCode: z.string().default('training_bandit') })
// LEGS не принимаем: зона разделена на левую и правую, старое значение
// живёт только в истории боёв и приходить с клиента больше не должно.
const ZoneEnum = z.enum(['HEAD', 'CHEST', 'RIGHT_ARM', 'LEFT_ARM', 'RIGHT_LEG', 'LEFT_LEG'])
const ActionSchema = z.object({
  action: z.enum(['attack', 'block', 'move', 'use_item', 'change_weapon', 'surrender']),
  itemInstanceId: z.string().uuid().optional(),
  weaponHand: z.enum(['LEFT_HAND', 'RIGHT_HAND']).optional(),
  moveTo: z.object({ x: z.number().int().min(0).max(8), y: z.number().int().min(0).max(8) }).optional(),
  targetParticipantId: z.string().uuid().optional(),
  // Зональная боёвка (опционально — старый фронт шлёт только action)
  stance: z.enum(['attack2', 'mixed', 'defense4']).optional(),
  attackZones: z.array(ZoneEnum).max(2).optional(),
  attackHands: z.array(z.enum(['LEFT_HAND', 'RIGHT_HAND'])).max(2).optional(),
  blockZones: z.array(ZoneEnum).max(4).optional(),
  // Этап 4: переодевание в бою. Часть обычного хода, а не отдельное
  // действие: цена снимается с бюджета хода в normalizeTurn.
  swapWeapon: z.object({
    hand: z.enum(['LEFT_HAND', 'RIGHT_HAND']),
    itemInstanceId: z.string().uuid(),
  }).optional(),
  swapArmor: z.object({
    zone: ZoneEnum,
    itemInstanceId: z.string().uuid(),
  }).optional(),
})
const CreateApplicationSchema = z.object({
  kind: z.enum(['DUEL', 'GROUP', 'CHAOTIC']),
  delayMinutes: z.number().int().refine(value => (APPLICATION_DELAYS as readonly number[]).includes(value)).optional(),
  teamSize: z.number().int().min(1).max(APPLICATION_MAX_TEAM).optional(),
  levelMin: z.number().int().min(1).max(99).optional(),
  levelMax: z.number().int().min(1).max(99).optional(),
})
const JoinApplicationSchema = z.object({ side: z.union([z.literal(1), z.literal(2)]).optional() })
const BattleIdParam = z.string().uuid()
const HistorySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export async function battlesRoutes(fastify: FastifyInstance): Promise<void> {

  // POST /api/battles/pve/start
  fastify.post('/pve/start', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = StartPveSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const result = await BattleService.startPve(req.authUser.userId, parsed.data.botCode)
      return reply.code(201).send(result)
    })

  // ── Заявки на бой ──────────────────────────────────────
  // Дуэли и групповые бои открываются только через заявку с таймером:
  // прежние ручки «создал — и сразу в бой» убраны по правке заказчика.

  // GET /api/battles/applications — общий список заявок и идущих боёв
  fastify.get('/applications', { preHandler: authenticate },
    async (req, reply) => reply.send(await ApplicationsService.list(req.authUser.userId)))

  // POST /api/battles/applications — подать заявку
  fastify.post('/applications', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = CreateApplicationSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Проверьте параметры заявки' })
      return reply.code(201).send(await ApplicationsService.create(req.authUser.userId, parsed.data))
    })

  // POST /api/battles/applications/:battleId/join — встать в заявку
  fastify.post<{ Params: { battleId: string } }>('/applications/:battleId/join', { preHandler: authenticate },
    async (req, reply) => {
      const id = BattleIdParam.safeParse(req.params.battleId)
      const body = JoinApplicationSchema.safeParse(req.body ?? {})
      if (!id.success || !body.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      return reply.send(await ApplicationsService.join(req.authUser.userId, id.data, body.data.side))
    })

  // POST /api/battles/applications/:battleId/leave — выйти (создатель снимает заявку)
  fastify.post<{ Params: { battleId: string } }>('/applications/:battleId/leave', { preHandler: authenticate },
    async (req, reply) => {
      const id = BattleIdParam.safeParse(req.params.battleId)
      if (!id.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      return reply.send(await ApplicationsService.leave(req.authUser.userId, id.data))
    })

  // GET /api/battles/me/current — заявка или бой, в котором сейчас персонаж
  fastify.get('/me/current', { preHandler: authenticate },
    async (req, reply) => reply.send(await ApplicationsService.current(req.authUser.userId)))

  // GET /api/battles/me/history — история боёв персонажа
  fastify.get('/me/history', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = HistorySchema.safeParse(req.query)
      const { page, limit } = parsed.success ? parsed.data : { page: 1, limit: 20 }
      const result = await BattleService.getBattleHistory(req.authUser.userId, page, limit)
      return reply.send(result)
    })

  // POST /api/battles/:battleId/action
  fastify.post<{ Params: { battleId: string } }>('/:battleId/action', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = ActionSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const result = await BattleService.submitAction(
        req.authUser.userId,
        req.params.battleId,
        {
          action: parsed.data.action,
          itemInstanceId: parsed.data.itemInstanceId,
          weaponHand: parsed.data.weaponHand,
          stance: parsed.data.stance,
          attackZones: parsed.data.attackZones,
          attackHands: parsed.data.attackHands,
          blockZones: parsed.data.blockZones,
          swapWeapon: parsed.data.swapWeapon,
          swapArmor: parsed.data.swapArmor,
          moveTo: parsed.data.moveTo,
          targetParticipantId: parsed.data.targetParticipantId,
        }
      )
      return reply.send(result)
    })

  // POST /api/battles/:battleId/helper-tactic — тактика боевого помощника в бою
  fastify.post<{ Params: { battleId: string }; Body: { tactic: string } }>('/:battleId/helper-tactic', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = z.object({ tactic: z.enum(['ATTACK', 'STANDARD', 'DEFENSIVE']) }).safeParse(req.body)
      if (!z.string().uuid().safeParse(req.params.battleId).success || !parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      return reply.send(await BattleService.setHelperTactic(req.params.battleId, req.authUser.userId, parsed.data.tactic))
    })

  // GET /api/battles/:battleId/journal?page=N — сохранённый журнал боя по 10 строк
  fastify.get<{ Params: { battleId: string }; Querystring: { page?: string } }>('/:battleId/journal', { preHandler: authenticate },
    async (req, reply) => {
      if (!z.string().uuid().safeParse(req.params.battleId).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const page = z.coerce.number().int().min(1).max(100_000).catch(1).parse(req.query.page)
      return reply.send(await BattleJournal.page(req.params.battleId, page))
    })

  // GET /api/battles/:battleId
  fastify.get<{ Params: { battleId: string } }>('/:battleId', { preHandler: authenticate },
    async (req, reply) => {
      const result = await BattleService.getBattle(req.params.battleId, req.authUser.userId)
      return reply.send(result)
    })
}
