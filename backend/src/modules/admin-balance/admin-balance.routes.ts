// =============================================================
// РУЧКИ УПРАВЛЕНИЯ: баланс, предметы, игроки, алерты.
//
// Читать может любой администратор, менять — только SUPER_ADMIN, и всё
// через журнал с обратной операцией: правило Этапа 5 «ничего без причины
// и ничего без отмены» распространяется и на правку баланса.
// =============================================================
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { requireAdminRole } from '../../shared/security/auth-middleware'
import { prisma } from '../../shared/db/prisma'
import { AdminActionsService, type AdminContext } from '../admin-actions/admin-actions.service'
import { getLatestEconomyMetrics, collectEconomyMetrics } from '../../workers/economy-metrics-daily.worker'
import { describeAlerts } from './alerts-registry'
import { balanceRegistry } from './balance-registry'
import {
  currentValue, defaultValue, limitsFor, listOverrides, validatePath,
} from './balance-overrides.service'
import { buildCatalog } from './catalog.service'
import { reasonFlowLabel, reasonTitle } from './reason-codes'
import { sendTelegram, telegramConfigured } from './telegram.service'

const READ_ADMIN = { preHandler: requireAdminRole('SUPER_ADMIN', 'MODERATOR', 'SUPPORT') }
const WRITE_ADMIN = { preHandler: requireAdminRole('SUPER_ADMIN') }
const MODERATE_ADMIN = { preHandler: requireAdminRole('SUPER_ADMIN', 'MODERATOR') }

const REASON = z.string().min(10).max(500)

// Состояния из enum'ов Prisma по-русски. Код рядом остаётся: по нему
// ищут в базе, а вот считать «CANCELLED» с экрана и понимать, отменил ли
// смену игрок или воркер, — работа, которой быть не должно.
const SHIFT_STATUS: Record<string, string> = {
  ACTIVE: 'Идут сейчас',
  READY_TO_CLAIM: 'Готовы, ждут выдачи',
  CLAIMED: 'Забраны игроком',
  CANCELLED: 'Отменены',
  FAILED: 'Сорвались',
}

const LISTING_STATUS: Record<string, string> = {
  ACTIVE: 'Выставлены',
  LOCKED: 'В сделке',
  SOLD: 'Проданы',
  CANCELLED: 'Сняты продавцом',
  EXPIRED: 'Просрочены',
}

function admin(req: FastifyRequest): AdminContext {
  return { adminId: req.adminUser.adminId, adminRole: req.adminUser.role }
}

export async function adminBalanceRoutes(fastify: FastifyInstance): Promise<void> {

  // ── Алерты ───────────────────────────────────────────────────
  //
  // Не список кодов, а разбор: что случилось, чем грозит, на кого именно
  // смотреть и что нажать. Код «HIGH_MONEY_GINI» сам по себе не говорит
  // администратору ничего.
  fastify.get('/alerts', READ_ADMIN, async (_req, reply) => {
    const snapshot = await getLatestEconomyMetrics()
    if (!snapshot) {
      return reply.send({ cards: [], snapshotDate: null })
    }
    return reply.send({ cards: await describeAlerts(snapshot), snapshotDate: snapshot.date })
  })

  /** Пересчитать метрики сейчас, не дожидаясь ночного воркера. */
  fastify.post('/alerts/recheck', MODERATE_ADMIN, async (_req, reply) => {
    const snapshot = await collectEconomyMetrics()
    return reply.send({ cards: await describeAlerts(snapshot), snapshotDate: snapshot.date })
  })

  // ── Оповещения ───────────────────────────────────────────────

  /** Настроен ли бот. Токен наружу не отдаётся — только факт наличия. */
  fastify.get('/telegram', READ_ADMIN, async (_req, reply) => {
    return reply.send({ configured: telegramConfigured() })
  })

  /** Проверка связи: одно сообщение в тот же чат, куда уходят алерты. */
  fastify.post('/telegram/test', WRITE_ADMIN, async (req, reply) => {
    const result = await sendTelegram(
      `✅ Проверка связи из админки «Кооператива». Отправил ${admin(req).adminId.slice(0, 8)}.`,
    )
    return reply.send(result)
  })

  /**
   * Подробности за карточкой обзора.
   *
   * Число на дашборде без разбивки — та самая «информация ради
   * информации»: «смен идёт 12» не говорит, где они идут и не застряли
   * ли. Здесь то, что стоит за числом, и куда с ним идти.
   */
  fastify.get<{ Params: { kind: string } }>('/overview/:kind', READ_ADMIN, async (req, reply) => {
    const kind = req.params.kind

    if (kind === 'money') {
      const [top, byReason] = await Promise.all([
        prisma.character.findMany({
          select: { id: true, nickname: true, money: true },
          orderBy: { money: 'desc' }, take: 8,
        }),
        prisma.currencyLog.groupBy({
          by: ['reasonCode'],
          where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
          _sum: { amount: true },
          orderBy: { _sum: { amount: 'desc' } },
          take: 10,
        }),
      ])
      return reply.send({
        title: 'Куда движутся деньги за сутки',
        rows: byReason.map(row => ({
          // Название человеческое, но код рядом: по нему ищут в журнале
          // и в коде, а «кран/сток» сразу говорит, меняет ли строка
          // денежную массу или это перекладывание между игроками.
          label: reasonTitle(row.reasonCode),
          hint: [row.reasonCode, reasonFlowLabel(row.reasonCode)].filter(Boolean).join(' · '),
          value: `${(row._sum?.amount ?? 0) >= 0 ? '+' : ''}${Math.round(row._sum?.amount ?? 0).toLocaleString('ru-RU')} ₽`,
        })),
        secondTitle: 'У кого больше всего',
        second: top.map(row => ({
          label: row.nickname, value: `${row.money.toLocaleString('ru-RU')} ₽`, characterId: row.id,
        })),
      })
    }

    if (kind === 'shifts') {
      const [byStatus, stuck] = await Promise.all([
        prisma.workShift.groupBy({ by: ['status'], _count: true }),
        prisma.workShift.findMany({
          where: { status: 'READY_TO_CLAIM' },
          select: { id: true, endsAt: true, character: { select: { id: true, nickname: true } } },
          orderBy: { endsAt: 'asc' }, take: 8,
        }),
      ])
      return reply.send({
        title: 'Смены по состояниям',
        rows: byStatus.map(row => ({
          label: SHIFT_STATUS[row.status] ?? row.status,
          hint: row.status,
          value: String(row._count),
        })),
        secondTitle: stuck.length ? 'Ждут выдачи дольше всех — если их много, проверьте воркер' : 'Ничего не зависло',
        second: stuck.map(row => ({
          label: `${row.character.nickname} · закончилась ${new Date(row.endsAt).toLocaleString('ru-RU')}`,
          value: '', characterId: row.character.id,
        })),
      })
    }

    if (kind === 'market') {
      const [byStatus, priciest] = await Promise.all([
        prisma.marketListing.groupBy({ by: ['status'], _count: true }),
        prisma.marketListing.findMany({
          where: { status: 'ACTIVE' },
          select: {
            id: true, price: true, sellerCharacterId: true,
            itemInstanceId: true, resourceTemplateId: true, resourceAmount: true,
          },
          orderBy: { price: 'desc' }, take: 8,
        }),
      ])

      // MarketListing хранит голые идентификаторы без связей Prisma, так
      // что имена подтягиваем отдельно. Оно того стоит: дорогой лот
      // смотрят, чтобы понять, не разгоняют ли цену, а по «лот dc7ece9e»
      // этого не видно — нужны вещь и продавец.
      const [sellers, instances, resources] = await Promise.all([
        prisma.character.findMany({
          where: { id: { in: priciest.map(row => row.sellerCharacterId) } },
          select: { id: true, nickname: true },
        }),
        prisma.itemInstance.findMany({
          where: { id: { in: priciest.flatMap(row => row.itemInstanceId ? [row.itemInstanceId] : []) } },
          select: { id: true, template: { select: { name: true } } },
        }),
        prisma.resourceTemplate.findMany({
          where: { id: { in: priciest.flatMap(row => row.resourceTemplateId ? [row.resourceTemplateId] : []) } },
          select: { id: true, name: true },
        }),
      ])
      const sellerName = new Map(sellers.map(row => [row.id, row.nickname]))
      const itemName = new Map(instances.map(row => [row.id, row.template.name]))
      const resourceName = new Map(resources.map(row => [row.id, row.name]))
      return reply.send({
        title: 'Лоты по состояниям',
        rows: byStatus.map(row => ({
          label: LISTING_STATUS[row.status] ?? row.status,
          hint: row.status,
          value: String(row._count),
        })),
        secondTitle: 'Самые дорогие активные лоты',
        second: priciest.map(row => {
          const resource = row.resourceTemplateId ? resourceName.get(row.resourceTemplateId) : undefined
          const what = (row.itemInstanceId ? itemName.get(row.itemInstanceId) : undefined)
            ?? (resource ? `${resource} ×${row.resourceAmount ?? 0}` : `лот ${row.id.slice(0, 8)}`)
          return {
            label: `${what} — ${sellerName.get(row.sellerCharacterId) ?? 'продавец удалён'}`,
            value: `${row.price.toLocaleString('ru-RU')} ₽`,
            characterId: row.sellerCharacterId,
          }
        }),
      })
    }

    if (kind === 'players') {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const [total, active, banned, fresh, newest] = await Promise.all([
        prisma.character.count(),
        prisma.user.count({ where: { lastLoginAt: { gte: dayAgo } } }),
        prisma.user.count({ where: { status: 'BANNED' } }),
        prisma.character.count({ where: { createdAt: { gte: dayAgo } } }),
        // Новички — единственное в этой карточке, с чем что-то делают:
        // накрутку и мультиаккаунт ищут именно среди свежих регистраций.
        prisma.character.findMany({
          select: { id: true, nickname: true, createdAt: true },
          orderBy: { createdAt: 'desc' }, take: 8,
        }),
      ])
      return reply.send({
        title: 'Кто в игре',
        rows: [
          { label: 'Персонажей всего', value: String(total) },
          { label: 'Заходили за сутки', value: String(active) },
          { label: 'Новых за сутки', value: String(fresh) },
          { label: 'Забанено', value: String(banned) },
        ],
        secondTitle: 'Последние регистрации',
        second: newest.map(row => ({
          label: row.nickname,
          value: new Date(row.createdAt).toLocaleString('ru-RU'),
          characterId: row.id,
        })),
      })
    }

    return reply.code(404).send({ code: 'GEN_002', message: 'Нет такой карточки' })
  })

  /**
   * Справочник игры целиком: ресурсы с цепочками, рецепты, огород,
   * объекты, госскупка, бар, боты. Одним запросом — данных на сотню
   * строк, а вкладок, между которыми переключаются, четыре: гонять
   * отдельный запрос на каждую значило бы ждать на каждом клике.
   */
  fastify.get('/catalog', READ_ADMIN, async (_req, reply) => {
    return reply.send(await buildCatalog())
  })

  // ── Баланс ───────────────────────────────────────────────────

  fastify.get('/balance', READ_ADMIN, async (_req, reply) => {
    const overrides = await listOverrides()
    const byPath = new Map(overrides.map(row => [row.path, row]))
    // К каждому коэффициенту прикладываем, правился ли он: без этого
    // администратор не отличит значение из кода от чьей-то вчерашней правки.
    const groups = balanceRegistry().map(group => ({
      ...group,
      formulas: group.formulas.map(formula => ({
        ...formula,
        params: formula.params.map(param => {
          const override = byPath.get(param.path)
          return {
            ...param,
            value: currentValue(param.path) ?? param.value,
            defaultValue: defaultValue(param.path),
            limits: limitsFor(param.path),
            override: override
              ? { reason: override.reason, updatedAt: override.updatedAt, adminId: override.adminId }
              : null,
          }
        }),
      })),
    }))
    return reply.send({ groups, overrides })
  })

  const ParamBody = z.object({
    path: z.string().min(3).max(120),
    value: z.union([z.number(), z.string(), z.boolean(), z.record(z.unknown()), z.array(z.unknown())]),
    reason: REASON,
  })

  fastify.patch('/balance/param', WRITE_ADMIN, async (req, reply) => {
    const parsed = ParamBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten() })
    }
    const { path, value, reason } = parsed.data

    const problem = validatePath(path, value)
    if (problem) return reply.code(422).send({ code: 'GEN_001', message: problem })

    const previous = currentValue(path)
    const isDefault = JSON.stringify(previous) === JSON.stringify(defaultValue(path))
    const context = admin(req)

    const action = await AdminActionsService.perform(context, reason, {
      kind: 'SET_BALANCE_PARAM',
      targetType: 'balance_param',
      targetId: path,
      payload: { path, value: value as Prisma.InputJsonValue, reason, adminId: context.adminId },
      // Откат: если правки раньше не было — снять её вовсе, иначе вернуть
      // прежнее значение. Пустое value читается исполнителем как «снять».
      undo: {
        kind: 'RESTORE_BALANCE_PARAM',
        payload: { path, value: (isDefault ? null : previous) as Prisma.InputJsonValue, reason, adminId: context.adminId },
      },
    })
    return reply.send({ actionId: action.actionId, path, value, previous })
  })

  /** Снять правку: значение возвращается к тому, что стоит в коде. */
  fastify.delete('/balance/param', WRITE_ADMIN, async (req, reply) => {
    const parsed = z.object({ path: z.string().min(3), reason: REASON }).safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten() })
    }
    const { path, reason } = parsed.data
    const previous = currentValue(path)
    const context = admin(req)

    const action = await AdminActionsService.perform(context, reason, {
      kind: 'RESTORE_BALANCE_PARAM',
      targetType: 'balance_param',
      targetId: path,
      payload: { path, value: null, reason, adminId: context.adminId },
      undo: {
        kind: 'SET_BALANCE_PARAM',
        payload: { path, value: previous as Prisma.InputJsonValue, reason, adminId: context.adminId },
      },
    })
    return reply.send({ actionId: action.actionId, path, restored: defaultValue(path) })
  })


  // ── Правка справочника ───────────────────────────────────────
  //
  // Базовая цена ресурса, цена в госмагазине, цена в баре и оклад
  // объекта — такие же коэффициенты экономики, как то, что лежит в
  // BalanceConfig, только хранятся в базе. Раньше их можно было менять
  // единственным способом: руками по живой базе, без причины и без
  // следа. Теперь — отсюда, парно и через журнал.
  //
  // Границы жёсткие намеренно. Цена ресурса в ноль обнуляет госскупку и
  // маржу всех рецептов на нём разом; оклад в сто тысяч печатает деньги
  // быстрее, чем воркер успеет заметить. Отменить-то можно, но сутки
  // экономики к тому времени уже испорчены.

  /** Общая часть: собрать прежние значения ровно тех полей, что меняем. */
  function previousOf(before: unknown, fields: Record<string, unknown>): Record<string, unknown> {
    const previous: Record<string, unknown> = {}
    for (const key of Object.keys(fields)) previous[key] = (before as Record<string, unknown>)[key]
    return previous
  }

  const RESOURCE_FIELDS = z.object({
    name: z.string().min(1).max(60).optional(),
    // Ноль запрещён: на базовую цену опирается и госскупка, и маржа
    // рецептов, и выгода огорода — обнулив её, экономику ресурса
    // выключают целиком, обычно не желая того.
    basePrice: z.number().int().min(1).max(1_000_000).optional(),
    weight: z.number().min(0).max(100).optional(),
    isTradable: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })

  fastify.patch<{ Params: { code: string } }>('/catalog/resource/:code', WRITE_ADMIN, async (req, reply) => {
    const parsed = z.object({ fields: RESOURCE_FIELDS, reason: REASON }).safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten() })
    }
    const code = req.params.code
    const before = await prisma.resourceTemplate.findUnique({ where: { code } })
    if (!before) return reply.code(404).send({ code: 'GEN_002', message: 'Ресурс не найден' })

    const fields = parsed.data.fields as Record<string, unknown>
    const previous = previousOf(before, fields)
    const action = await AdminActionsService.perform(admin(req), parsed.data.reason, {
      kind: 'SET_RESOURCE_TEMPLATE',
      targetType: 'resource_template',
      targetId: code,
      payload: { code, fields: fields as Prisma.InputJsonValue },
      undo: { kind: 'RESTORE_RESOURCE_TEMPLATE', payload: { code, fields: previous as Prisma.InputJsonValue } },
    })
    return reply.send({ actionId: action.actionId, code, fields, previous })
  })

  const SHOP_FIELDS = z.object({
    // null возвращает позицию к цене из шаблона предмета — это отдельное
    // осмысленное состояние, а не «не трогать».
    overridePrice: z.number().int().min(1).max(10_000_000).nullable().optional(),
    isAvailable: z.boolean().optional(),
  })

  fastify.patch<{ Params: { code: string } }>('/catalog/shop/:code', WRITE_ADMIN, async (req, reply) => {
    const parsed = z.object({ fields: SHOP_FIELDS, reason: REASON }).safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten() })
    }
    // Адресуемся кодом предмета: id позиции магазина в панели не виден и
    // человеку ничего не говорит.
    const template = await prisma.itemTemplate.findUnique({ where: { code: req.params.code }, select: { id: true } })
    const before = template
      ? await prisma.governmentShopItem.findUnique({ where: { templateId: template.id } })
      : null
    if (!before) return reply.code(404).send({ code: 'GEN_002', message: 'Позиция госмагазина не найдена' })

    const fields = parsed.data.fields as Record<string, unknown>
    const previous = previousOf(before, fields)
    const action = await AdminActionsService.perform(admin(req), parsed.data.reason, {
      kind: 'SET_SHOP_ITEM',
      targetType: 'government_shop_item',
      targetId: before.id,
      payload: { id: before.id, fields: fields as Prisma.InputJsonValue },
      undo: { kind: 'RESTORE_SHOP_ITEM', payload: { id: before.id, fields: previous as Prisma.InputJsonValue } },
    })
    return reply.send({ actionId: action.actionId, code: req.params.code, fields, previous })
  })

  const BAR_FIELDS = z.object({
    price: z.number().int().min(1).max(1_000_000).optional(),
    hpRestore: z.number().int().min(0).max(10_000).optional(),
    accuracyBuff: z.number().min(0).max(1).optional(),
    damageBuff: z.number().min(0).max(1).optional(),
    buffMinutes: z.number().int().min(0).max(1440).optional(),
    isActive: z.boolean().optional(),
  })

  fastify.patch<{ Params: { code: string } }>('/catalog/bar/:code', WRITE_ADMIN, async (req, reply) => {
    const parsed = z.object({ fields: BAR_FIELDS, reason: REASON }).safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten() })
    }
    const code = req.params.code
    const before = await prisma.barOffer.findUnique({ where: { code } })
    if (!before) return reply.code(404).send({ code: 'GEN_002', message: 'Позиция бара не найдена' })

    const fields = parsed.data.fields as Record<string, unknown>
    const previous = previousOf(before, fields)
    const action = await AdminActionsService.perform(admin(req), parsed.data.reason, {
      kind: 'SET_BAR_OFFER',
      targetType: 'bar_offer',
      targetId: code,
      payload: { code, fields: fields as Prisma.InputJsonValue },
      undo: { kind: 'RESTORE_BAR_OFFER', payload: { code, fields: previous as Prisma.InputJsonValue } },
    })
    return reply.send({ actionId: action.actionId, code, fields, previous })
  })

  const OBJECT_FIELDS = z.object({
    // Оклад — главный законный кран денег в игре, поэтому потолок здесь
    // ниже, чем у прочих цен: ошибка на порядок тут дороже всего.
    baseSalary: z.number().int().min(1).max(10_000).optional(),
    shiftDurationMinutes: z.number().int().min(5).max(240).optional(),
    workerSlots: z.number().int().min(1).max(200).optional(),
    outputAmountMin: z.number().int().min(0).max(1000).optional(),
    outputAmountMax: z.number().int().min(0).max(1000).optional(),
    storageCapacity: z.number().int().min(0).max(1_000_000).optional(),
    isActive: z.boolean().optional(),
  })

  fastify.patch<{ Params: { code: string } }>('/catalog/object/:code', WRITE_ADMIN, async (req, reply) => {
    const parsed = z.object({ fields: OBJECT_FIELDS, reason: REASON }).safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten() })
    }
    const code = req.params.code
    const before = await prisma.productionObject.findUnique({ where: { code } })
    if (!before) return reply.code(404).send({ code: 'GEN_002', message: 'Объект не найден' })

    const fields = parsed.data.fields as Record<string, number | boolean>
    // Вилка выхода задом наперёд — молчаливая поломка: объект перестанет
    // выдавать что-либо, и понять почему будет неоткуда.
    const min = (fields.outputAmountMin as number | undefined) ?? before.outputAmountMin
    const max = (fields.outputAmountMax as number | undefined) ?? before.outputAmountMax
    if (min > max) {
      return reply.code(422).send({
        code: 'GEN_001',
        message: `Нижняя граница выхода (${min}) больше верхней (${max}) — объект перестанет что-либо выдавать`,
      })
    }

    const previous = previousOf(before, fields)
    const action = await AdminActionsService.perform(admin(req), parsed.data.reason, {
      kind: 'SET_PRODUCTION_OBJECT',
      targetType: 'production_object',
      targetId: code,
      payload: { code, fields: fields as Prisma.InputJsonValue },
      undo: { kind: 'RESTORE_PRODUCTION_OBJECT', payload: { code, fields: previous as Prisma.InputJsonValue } },
    })
    return reply.send({ actionId: action.actionId, code, fields, previous })
  })

  // ── Предметы ─────────────────────────────────────────────────

  const ITEM_FIELDS = z.object({
    name: z.string().min(1).max(60).optional(),
    priceBase: z.number().int().min(0).max(10_000_000).optional(),
    levelReq: z.number().int().min(0).max(30).optional(),
    minDamage: z.number().int().min(0).max(1000).nullable().optional(),
    maxDamage: z.number().int().min(0).max(1000).nullable().optional(),
    weaponAccuracy: z.number().min(0).max(1).nullable().optional(),
    armor: z.number().int().min(0).max(500).nullable().optional(),
    durabilityMax: z.number().int().min(1).max(10_000).optional(),
    weight: z.number().min(0).max(100).optional(),
  })

  fastify.patch<{ Params: { code: string } }>('/items/:code', WRITE_ADMIN, async (req, reply) => {
    const parsed = z.object({ fields: ITEM_FIELDS, reason: REASON }).safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten() })
    }
    const code = req.params.code
    const before = await prisma.itemTemplate.findUnique({ where: { code } })
    if (!before) return reply.code(404).send({ code: 'GEN_002', message: 'Предмет не найден' })

    // Обратная операция — прежние значения ровно тех полей, что меняем.
    // Писать всю строку целиком нельзя: соседние поля мог изменить кто-то
    // другой, и откат затёр бы чужую правку.
    const fields = parsed.data.fields as Record<string, unknown>
    const previous: Record<string, unknown> = {}
    for (const key of Object.keys(fields)) previous[key] = (before as Record<string, unknown>)[key]

    const action = await AdminActionsService.perform(admin(req), parsed.data.reason, {
      kind: 'SET_ITEM_TEMPLATE',
      targetType: 'item_template',
      targetId: code,
      payload: { code, fields: fields as Prisma.InputJsonValue },
      undo: { kind: 'RESTORE_ITEM_TEMPLATE', payload: { code, fields: previous as Prisma.InputJsonValue } },
    })
    return reply.send({ actionId: action.actionId, code, fields, previous })
  })

  const NEW_ITEM = z.object({
    code: z.string().min(3).max(60).regex(/^[a-z0-9_]+$/, 'только строчные латинские, цифры и подчёркивание'),
    name: z.string().min(1).max(60),
    type: z.enum(['WEAPON', 'ARMOR', 'CONSUMABLE', 'TOOL', 'RESOURCE', 'MISC']),
    priceBase: z.number().int().min(0).max(10_000_000),
    levelReq: z.number().int().min(0).max(30),
    durabilityMax: z.number().int().min(1).max(10_000),
    weight: z.number().min(0).max(100),
    minDamage: z.number().int().min(0).max(1000).nullable(),
    maxDamage: z.number().int().min(0).max(1000).nullable(),
    weaponAccuracy: z.number().min(0).max(1).nullable(),
    armor: z.number().int().min(0).max(500).nullable(),
  })

  fastify.post('/items', WRITE_ADMIN, async (req, reply) => {
    const parsed = z.object({ item: NEW_ITEM, reason: REASON }).safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten() })
    }
    const { item, reason } = parsed.data
    if (await prisma.itemTemplate.findUnique({ where: { code: item.code } })) {
      return reply.code(409).send({ code: 'GEN_005', message: `Предмет «${item.code}» уже есть` })
    }

    const action = await AdminActionsService.perform(admin(req), reason, {
      kind: 'CREATE_ITEM_TEMPLATE',
      targetType: 'item_template',
      targetId: item.code,
      payload: { fields: item },
      undo: { kind: 'DELETE_ITEM_TEMPLATE', payload: { code: item.code } },
    })
    return reply.code(201).send({ actionId: action.actionId, code: item.code })
  })

  // ── Игроки ───────────────────────────────────────────────────

  fastify.get('/players', READ_ADMIN, async (req, reply) => {
    const query = req.query as { search?: string; sort?: string; limit?: string }
    const search = (query.search ?? '').trim()
    const take = Math.min(100, Math.max(1, Number(query.limit ?? 50)))
    const order = query.sort === 'level'
      ? { battleLevel: 'desc' as const }
      : query.sort === 'new'
        ? { createdAt: 'desc' as const }
        : { money: 'desc' as const }

    const characters = await prisma.character.findMany({
      where: search
        ? { OR: [{ nickname: { contains: search, mode: 'insensitive' } }, { user: { login: { contains: search, mode: 'insensitive' } } }] }
        : {},
      select: {
        id: true, nickname: true, money: true, battleLevel: true, economicLevel: true,
        createdAt: true,
        user: { select: { id: true, login: true, status: true, mutedUntil: true, lastLoginAt: true } },
      },
      orderBy: order,
      take,
    })
    return reply.send({ items: characters })
  })

  fastify.get<{ Params: { id: string } }>('/players/:id', READ_ADMIN, async (req, reply) => {
    const character = await prisma.character.findUnique({
      where: { id: req.params.id },
      include: {
        stats: true,
        user: { select: { id: true, login: true, email: true, status: true, banReason: true, mutedUntil: true, registeredAt: true, lastLoginAt: true, lastIp: true } },
        weaponSkills: true,
      },
    })
    if (!character) return reply.code(404).send({ code: 'GEN_002', message: 'Персонаж не найден' })

    const [money, items, battles, clan] = await Promise.all([
      prisma.currencyLog.findMany({
        where: { characterId: character.id }, orderBy: { createdAt: 'desc' }, take: 20,
      }),
      prisma.itemInstance.findMany({
        // Выставленное на рынок тоже принадлежит игроку. Показывать
        // «вещей нет» человеку, у которого висит десяток лотов, — прямой
        // обман: именно эти лоты и смотрят, разбирая перекачку денег.
        where: { ownerId: character.id, status: { in: ['NORMAL', 'ON_MARKET'] } },
        select: { id: true, isEquipped: true, status: true, quality: true, durabilityCurrent: true, template: { select: { name: true, type: true, priceBase: true } } },
        take: 60,
      }),
      prisma.battleParticipant.count({ where: { characterId: character.id } }),
      prisma.clanMember.findFirst({
        where: { characterId: character.id, status: 'ACTIVE' },
        select: { role: true, clan: { select: { id: true, name: true, tag: true } } },
      }),
    ])
    return reply.send({
      character,
      // Код причины оставляем — по нему ищут в журнале, — но рядом кладём
      // название: строка «UPGRADE_USE −450 ₽» без словаря нечитаема.
      money: money.map(row => ({ ...row, reasonTitle: reasonTitle(row.reasonCode) })),
      items, battles, clan,
    })
  })

  const BanBody = z.object({ reason: REASON })

  fastify.post<{ Params: { id: string } }>('/players/:id/ban', MODERATE_ADMIN, async (req, reply) => {
    const parsed = BanBody.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Нужна причина от 10 символов' })
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } })
    if (!user) return reply.code(404).send({ code: 'GEN_002', message: 'Учётная запись не найдена' })

    const action = await AdminActionsService.perform(admin(req), parsed.data.reason, {
      kind: 'BAN_USER',
      targetType: 'user',
      targetId: user.id,
      payload: { userId: user.id, banReason: parsed.data.reason },
      undo: { kind: 'UNBAN_USER', payload: { userId: user.id } },
    })
    return reply.send({ actionId: action.actionId })
  })

  fastify.post<{ Params: { id: string } }>('/players/:id/unban', MODERATE_ADMIN, async (req, reply) => {
    const parsed = BanBody.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Нужна причина от 10 символов' })
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, banReason: true } })
    if (!user) return reply.code(404).send({ code: 'GEN_002', message: 'Учётная запись не найдена' })

    const action = await AdminActionsService.perform(admin(req), parsed.data.reason, {
      kind: 'UNBAN_USER',
      targetType: 'user',
      targetId: user.id,
      payload: { userId: user.id },
      undo: { kind: 'BAN_USER', payload: { userId: user.id, banReason: user.banReason ?? '' } },
    })
    return reply.send({ actionId: action.actionId })
  })

  fastify.post<{ Params: { id: string } }>('/players/:id/mute', MODERATE_ADMIN, async (req, reply) => {
    const parsed = z.object({ reason: REASON, hours: z.number().int().min(1).max(720) }).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Нужны причина и срок в часах' })
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, mutedUntil: true } })
    if (!user) return reply.code(404).send({ code: 'GEN_002', message: 'Учётная запись не найдена' })

    const until = new Date(Date.now() + parsed.data.hours * 60 * 60 * 1000)
    const action = await AdminActionsService.perform(admin(req), parsed.data.reason, {
      kind: 'MUTE_USER',
      targetType: 'user',
      targetId: user.id,
      payload: { userId: user.id, mutedUntil: until.toISOString() },
      // Возврат к прежнему сроку, а не к пустому: игрок мог быть в немоте
      // и до этого, и снимать её целиком было бы подарком.
      undo: {
        kind: 'UNMUTE_USER',
        payload: { userId: user.id, mutedUntil: user.mutedUntil ? user.mutedUntil.toISOString() : null },
      },
    })
    return reply.send({ actionId: action.actionId, mutedUntil: until })
  })
}
