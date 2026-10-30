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
import { requirePermission } from '../../shared/security/auth-middleware'
import { prisma } from '../../shared/db/prisma'
import { AdminActionsService, type AdminContext } from '../admin-actions/admin-actions.service'
import { getLatestEconomyMetrics, collectEconomyMetrics } from '../../workers/economy-metrics-daily.worker'
import { describeAlerts } from './alerts-registry'
import { balanceRegistry } from './balance-registry'
import {
  currentValue, defaultValue, limitsFor, listOverrides, validatePath,
} from './balance-overrides.service'
import { buildCatalog } from './catalog.service'
import { ITEM_STAT_KEYS, allowedItemStats } from '../items/item-stats.formulas'
import { GEAR_STAT_KEYS, GEAR_STAT_LIMIT, CHARM_KEYS, MASTERY_KEYS } from '../items/gear-bonuses'

// Прибавки вещи к характеристикам персонажа и обереги — в плюс и в минус
// (правка заказчика 26.10). Оберег — доля: 0,1 = 10%, предел ±200%.
const GEAR_FIELDS = {
  statBonuses: z.partialRecord(z.enum(GEAR_STAT_KEYS), z.number().int().min(-GEAR_STAT_LIMIT).max(GEAR_STAT_LIMIT)).optional(),
  antiDodge: z.number().min(-2).max(2).optional(),
  antiLuck: z.number().min(-2).max(2).optional(),
  antiCrit: z.number().min(-2).max(2).optional(),
  antiCounter: z.number().min(-2).max(2).optional(),
  // Минус-обереги и мастерства, проценты (правка 31.10).
  extraBonuses: z.object({
    minusCharms: z.partialRecord(z.enum(CHARM_KEYS), z.number().min(0).max(100)).optional(),
    mastery: z.partialRecord(z.enum(MASTERY_KEYS), z.number().min(0).max(100)).optional(),
    minusMastery: z.partialRecord(z.enum(MASTERY_KEYS), z.number().min(0).max(100)).optional(),
  }).optional(),
}
import { PROFESSION_NAMES, type ProfessionCode } from '../professions/professions'
import { reasonFlowLabel, reasonTitle } from './reason-codes'
import { sendTelegram, telegramConfigured } from './telegram.service'

const READ_ADMIN = { preHandler: requirePermission('view') }
// Права по смыслу ручки (правка 30.10): справочник, баланс, выдача.
const CATALOG_ADMIN = { preHandler: requirePermission('catalog') }
const BALANCE_ADMIN = { preHandler: requirePermission('balance') }
const GRANT_ADMIN = { preHandler: requirePermission('grant') }
const MODERATE_ADMIN = { preHandler: requirePermission('moderate') }

const REASON = z.string().min(10).max(500)

/** Поля админских форм по-русски — для понятной ошибки проверки. */
const FIELD_LABELS: Record<string, string> = {
  reason: 'Причина', name: 'Название', code: 'Код', description: 'Описание', type: 'Что это',
  weaponType: 'Вид оружия', armorSlot: 'Куда надевается', priceBase: 'Цена', levelReq: 'Уровень',
  durabilityMax: 'Прочность', weight: 'Вес', minDamage: 'Урон от', maxDamage: 'Урон до',
  weaponAccuracy: 'Точность', maxRange: 'Дальность', armor: 'Броня', critBonus: 'Крит',
  dodgeBonus: 'Уворот', hpBonus: 'Здоровье', statBudget: 'Очков статов', allocationMode: 'Кто распределяет',
  statAllocation: 'Распределение очков', statBonuses: 'Характеристики персонажа',
  antiDodge: 'Оберег уворота', antiLuck: 'Оберег удачи', antiCrit: 'Оберег крита', antiCounter: 'Оберег ответа',
  sale: 'Магазин', price: 'Цена в магазине', shop: 'Магазин',
  str: 'Сила', end: 'Выносливость', luck: 'Фарт', agi: 'Ловкость', acc: 'Меткость', agr: 'Агрессия', rea: 'Реакция',
  extraBonuses: 'Минус-обереги и мастерства',
}

/**
 * «Validation error» ничего не говорит человеку (заказчик 26.10: «вещи не
 * создаются, пишет Валидейшн эррор»). Называем поле и что с ним не так.
 */
function validationMessage(error: z.ZodError): string {
  const parts = error.issues.slice(0, 4).map(issue => {
    const field = issue.path.filter(p => typeof p === 'string' && p !== 'item' && p !== 'fields').map(p => FIELD_LABELS[p as string] ?? String(p)).join(' → ') || 'Поле'
    const i = issue as { code: string; message: string; minimum?: number | bigint; maximum?: number | bigint; expected?: string }
    const what = i.code === 'too_small' ? `не меньше ${i.minimum}`
      : i.code === 'too_big' ? `не больше ${i.maximum}`
        : i.code === 'invalid_type' && i.expected === 'int' ? 'целое число'
          : i.code === 'invalid_type' ? 'нужно заполнить'
            : i.code === 'invalid_value' || i.code === 'invalid_enum_value' ? 'нет такого варианта'
              : i.message
    return `${field}: ${what}`
  })
  return `Проверьте: ${parts.join('; ')}`
}

/** Почему новую вещь в таком виде создать нельзя, или null. */
function newItemProblem(item: {
  type: string; weaponType?: string | null; armorSlot?: string | null; minDamage: number | null; maxDamage: number | null
  statBudget?: number; allocationMode?: string; statAllocation?: Partial<Record<string, number>>
}): string | null {
  if (item.type === 'WEAPON') {
    if (!item.weaponType) return 'У оружия нужен вид: нож, дубинка, пистолет…'
    if (item.minDamage == null || item.maxDamage == null) return 'У оружия нужен урон от и до'
    if (item.minDamage > item.maxDamage) return 'Урон «от» больше, чем «до»'
  }
  if (item.type === 'ARMOR' && !item.armorSlot) return 'У одежды нужен слот: шапка, броня, штаны, обувь…'
  if (item.allocationMode === 'FIXED') {
    const allowed = new Set<string>(allowedItemStats(item.type === 'ACCESSORY' ? 'ARMOR' : item.type))
    const entries = Object.entries(item.statAllocation ?? {}).filter(([, v]) => (v ?? 0) > 0)
    const wrong = entries.find(([key]) => !allowed.has(key))
    if (wrong) return `Стат «${wrong[0]}» этой вещи не положен`
    const sum = entries.reduce((total, [, v]) => total + (v ?? 0), 0)
    if (sum > (item.statBudget ?? 0)) return `Расставлено ${sum} очков при бюджете ${item.statBudget ?? 0}`
  }
  return null
}

/** Код для новой вещи, если его не задали: вид + слот + случайный хвост. */
function newItemCode(type: string, kind: string | null): string {
  return [type, kind, Date.now().toString(36), Math.random().toString(36).slice(2, 5)].filter(Boolean).join('_').toLowerCase()
}

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
  fastify.post('/telegram/test', BALANCE_ADMIN, async (req, reply) => {
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
    value: z.union([z.number(), z.string(), z.boolean(), z.record(z.string(), z.unknown()), z.array(z.unknown())]),
    reason: REASON,
  })

  fastify.patch('/balance/param', BALANCE_ADMIN, async (req, reply) => {
    const parsed = ParamBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: validationMessage(parsed.error), details: parsed.error.flatten() })
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
  fastify.delete('/balance/param', BALANCE_ADMIN, async (req, reply) => {
    const parsed = z.object({ path: z.string().min(3), reason: REASON }).safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: validationMessage(parsed.error), details: parsed.error.flatten() })
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

  fastify.patch<{ Params: { code: string } }>('/catalog/resource/:code', CATALOG_ADMIN, async (req, reply) => {
    const parsed = z.object({ fields: RESOURCE_FIELDS, reason: REASON }).safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: validationMessage(parsed.error), details: parsed.error.flatten() })
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

  fastify.patch<{ Params: { code: string } }>('/catalog/shop/:code', CATALOG_ADMIN, async (req, reply) => {
    const parsed = z.object({ fields: SHOP_FIELDS, reason: REASON }).safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: validationMessage(parsed.error), details: parsed.error.flatten() })
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

  // ── Витрины ЦУМа и Берёзки (правка 30.10) ───────────────────

  fastify.get('/catalog/dollar-shops', READ_ADMIN, async () => {
    const rows = await prisma.dollarShopItem.findMany({
      orderBy: [{ shop: 'asc' }, { sortOrder: 'asc' }, { priceDollars: 'asc' }],
      select: { id: true, shop: true, priceDollars: true, isAvailable: true, template: { select: { code: true, name: true, type: true, levelReq: true, isActive: true } } },
    })
    return { items: rows }
  })

  /** Выставить вещь в ЦУМ или Берёзку, сменить цену или снять с продажи. */
  fastify.put<{ Params: { shop: string; code: string } }>('/catalog/dollar-shops/:shop/:code', CATALOG_ADMIN, async (req, reply) => {
    const shop = z.enum(['TSUM', 'BEREZKA']).safeParse(req.params.shop)
    const parsed = z.object({
      fields: z.object({ priceDollars: z.number().int().min(1).max(100_000).optional(), isAvailable: z.boolean().optional() }),
      reason: REASON,
    }).safeParse(req.body)
    if (!shop.success || !parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: parsed.success ? 'Магазин — ЦУМ или Берёзка' : validationMessage(parsed.error) })
    }
    const template = await prisma.itemTemplate.findUnique({ where: { code: req.params.code }, select: { id: true, name: true } })
    if (!template) return reply.code(404).send({ code: 'GEN_002', message: `Вещи с кодом «${req.params.code}» нет` })
    const before = await prisma.dollarShopItem.findUnique({ where: { shop_templateId: { shop: shop.data, templateId: template.id } } })
    if (!before && !parsed.data.fields.priceDollars) return reply.code(422).send({ code: 'GEN_001', message: 'Укажите цену в долларах' })
    const fields = parsed.data.fields
    const previous = before ? previousOf(before, fields as Record<string, unknown>) : null
    const action = await AdminActionsService.perform(admin(req), parsed.data.reason, {
      kind: 'SET_DOLLAR_SHOP_ITEM',
      targetType: 'dollar_shop_item',
      targetId: `${shop.data}:${req.params.code}`,
      payload: { shop: shop.data, templateId: template.id, fields: fields as Prisma.InputJsonValue },
      undo: { kind: 'RESTORE_DOLLAR_SHOP_ITEM', payload: { shop: shop.data, templateId: template.id, fields: previous as Prisma.InputJsonValue } },
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

  fastify.patch<{ Params: { code: string } }>('/catalog/bar/:code', CATALOG_ADMIN, async (req, reply) => {
    const parsed = z.object({ fields: BAR_FIELDS, reason: REASON }).safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: validationMessage(parsed.error), details: parsed.error.flatten() })
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

  fastify.patch<{ Params: { code: string } }>('/catalog/object/:code', CATALOG_ADMIN, async (req, reply) => {
    const parsed = z.object({ fields: OBJECT_FIELDS, reason: REASON }).safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: validationMessage(parsed.error), details: parsed.error.flatten() })
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
    // Правка вещи той же формой, что и создание (30.10): всё, кроме типа и слота.
    description: z.string().max(300).nullable().optional(),
    maxRange: z.number().int().min(1).max(20).nullable().optional(),
    critBonus: z.number().min(0).max(1).optional(),
    dodgeBonus: z.number().min(0).max(1).optional(),
    hpBonus: z.number().int().min(0).max(1000).optional(),
    statBudget: z.number().int().min(0).max(200).optional(),
    allocationMode: z.enum(['FIXED', 'PLAYER']).optional(),
    statAllocation: z.partialRecord(z.enum(ITEM_STAT_KEYS), z.number().int().min(0).max(200)).nullable().optional(),
    ...GEAR_FIELDS,
  })

  fastify.patch<{ Params: { code: string } }>('/items/:code', CATALOG_ADMIN, async (req, reply) => {
    const parsed = z.object({ fields: ITEM_FIELDS, reason: REASON }).safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: validationMessage(parsed.error), details: parsed.error.flatten() })
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

  // Новая вещь целиком (просьба заказчика 25.10: «по шмоту — буду сам
  // добавлять»): слот, вид оружия, очки статов и как они распределяются,
  // бонусы и магазин, где вещь продаётся. Код можно не задавать — соберём.
  const NEW_ITEM = z.object({
    code: z.string().min(3).max(60).regex(/^[a-z0-9_]+$/, 'только строчные латинские, цифры и подчёркивание').optional(),
    name: z.string().min(1).max(60),
    description: z.string().max(300).optional(),
    type: z.enum(['WEAPON', 'ARMOR', 'SHIELD', 'ACCESSORY', 'CONSUMABLE', 'TOOL']),
    weaponType: z.enum(['MELEE', 'KNIFE', 'CLUB', 'PISTOL', 'SHOTGUN', 'SMG', 'RIFLE', 'SNIPER', 'HEAVY', 'THROWN']).nullable().optional(),
    armorSlot: z.enum(['HEAD', 'CHEST', 'LEGS', 'FEET', 'GLOVES', 'BELT', 'BACK', 'ACCESSORY']).nullable().optional(),
    priceBase: z.number().int().min(0).max(10_000_000),
    levelReq: z.number().int().min(0).max(30),
    durabilityMax: z.number().int().min(1).max(10_000),
    weight: z.number().min(0).max(100),
    minDamage: z.number().int().min(0).max(1000).nullable(),
    maxDamage: z.number().int().min(0).max(1000).nullable(),
    weaponAccuracy: z.number().min(0).max(1).nullable(),
    maxRange: z.number().int().min(1).max(20).nullable().optional(),
    armor: z.number().int().min(0).max(500).nullable(),
    critBonus: z.number().min(0).max(1).optional(),
    dodgeBonus: z.number().min(0).max(1).optional(),
    hpBonus: z.number().int().min(0).max(1000).optional(),
    ...GEAR_FIELDS,
    statBudget: z.number().int().min(0).max(200).optional(),
    allocationMode: z.enum(['FIXED', 'PLAYER']).optional(),
    statAllocation: z.partialRecord(z.enum(ITEM_STAT_KEYS), z.number().int().min(0).max(200)).optional(),
  })
  const SALE = z.object({
    // ЦУМ и Берёзка — за доллары (правка 30.10), остальные — за рубли.
    shop: z.enum(['GOVERNMENT', 'TSUM', 'BEREZKA', 'kommersant', 'armory_garage']),
    price: z.number().int().min(0).max(10_000_000),
  }).nullable().optional()

  fastify.post('/items', CATALOG_ADMIN, async (req, reply) => {
    const parsed = z.object({ item: NEW_ITEM, sale: SALE, reason: REASON }).safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: validationMessage(parsed.error), details: parsed.error.flatten() })
    }
    const { item, reason } = parsed.data
    const sale = parsed.data.sale ?? null
    const problem = newItemProblem(item)
    if (problem) return reply.code(422).send({ code: 'GEN_001', message: problem })
    const code = item.code ?? newItemCode(item.type, item.armorSlot ?? item.weaponType ?? null)
    if (await prisma.itemTemplate.findUnique({ where: { code } })) {
      return reply.code(409).send({ code: 'GEN_005', message: `Предмет «${code}» уже есть` })
    }
    const fields = {
      ...item, code,
      weaponType: item.type === 'WEAPON' ? item.weaponType ?? null : null,
      armorSlot: item.type === 'WEAPON' ? null : item.type === 'SHIELD' ? 'RIGHT_HAND' : item.armorSlot ?? null,
      optimalRange: item.maxRange ?? 1,
      // Вещь, которую продаёт лавка, — частная; госмагазин — государственная.
      sourceType: sale?.shop === 'GOVERNMENT' ? 'GOVERNMENT' : sale?.shop === 'TSUM' || sale?.shop === 'BEREZKA' ? 'DONATE' : sale ? 'PRIVATE' : 'ADMIN',
      privateShopAllowed: !!sale && !['GOVERNMENT', 'TSUM', 'BEREZKA'].includes(sale.shop),
      // Госвещи готовые: статы заданы, улучшать нечего (заказчик 30.10).
      upgradeAllowed: ['WEAPON', 'ARMOR', 'SHIELD'].includes(item.type) && sale?.shop !== 'GOVERNMENT',
      ...(sale?.shop === 'GOVERNMENT' ? { statBudget: 0, allocationMode: 'FIXED' as const } : {}),
      isEquippable: ['WEAPON', 'ARMOR', 'SHIELD', 'ACCESSORY'].includes(item.type),
      statAllocation: sale?.shop === 'GOVERNMENT' ? {} : item.allocationMode === 'FIXED' ? item.statAllocation ?? {} : undefined,
    }

    const action = await AdminActionsService.perform(admin(req), reason, {
      kind: 'CREATE_ITEM_TEMPLATE',
      targetType: 'item_template',
      targetId: code,
      payload: { fields: fields as Prisma.InputJsonValue, sale: sale as Prisma.InputJsonValue },
      undo: { kind: 'DELETE_ITEM_TEMPLATE', payload: { code } },
    })
    return reply.code(201).send({ actionId: action.actionId, code })
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

    const [money, items, battles, clan, resources, professions, shifts, adminActions, upgrades] = await Promise.all([
      prisma.currencyLog.findMany({
        where: { characterId: character.id }, orderBy: { createdAt: 'desc' }, take: 20,
      }),
      prisma.itemInstance.findMany({
        // Выставленное на рынок тоже принадлежит игроку. Показывать
        // «вещей нет» человеку, у которого висит десяток лотов, — прямой
        // обман: именно эти лоты и смотрят, разбирая перекачку денег.
        where: { ownerId: character.id, status: { in: ['NORMAL', 'ON_MARKET'] } },
        select: {
          id: true, isEquipped: true, status: true, quality: true,
          durabilityCurrent: true, durabilityMax: true, upgradeLevel: true,
          template: { select: { code: true, name: true, type: true, priceBase: true } },
        },
        take: 60,
      }),
      prisma.battleParticipant.count({ where: { characterId: character.id } }),
      prisma.clanMember.findFirst({
        where: { characterId: character.id, status: 'ACTIVE' },
        select: { role: true, clan: { select: { id: true, name: true, tag: true } } },
      }),
      // Ресурсы на руках: половина экономики игрока живёт не в деньгах, и
      // разбирая перелив, смотрят именно на них.
      prisma.resourceStack.findMany({
        where: { characterId: character.id, amount: { gt: 0 } },
        select: { amount: true, reservedAmount: true, template: { select: { code: true, name: true, basePrice: true } } },
        orderBy: { amount: 'desc' },
      }),
      prisma.characterProfession.findMany({
        where: { characterId: character.id },
        orderBy: { level: 'desc' },
      }),
      prisma.workShift.findMany({
        where: { characterId: character.id },
        orderBy: { startedAt: 'desc' }, take: 10,
        select: {
          id: true, status: true, startedAt: true, endsAt: true,
          productionObject: { select: { code: true, name: true } },
        },
      }),
      // Что с этим игроком уже делали админы. Без этого разбор жалобы
      // начинается с вопроса «а его вообще трогали?», ответа на который
      // в карточке не было.
      prisma.adminActionLog.findMany({
        where: {
          OR: [
            { targetType: 'character', targetId: character.id },
            { targetType: 'user', targetId: character.userId },
          ],
        },
        orderBy: { createdAt: 'desc' }, take: 10,
        select: { id: true, kind: true, reason: true, createdAt: true, rolledBackAt: true },
      }),
      prisma.upgradeLog.groupBy({
        by: ['result'], where: { characterId: character.id }, _count: true,
      }),
    ])

    return reply.send({
      character,
      // Код причины оставляем — по нему ищут в журнале, — но рядом кладём
      // название: строка «UPGRADE_USE −450 ₽» без словаря нечитаема.
      money: money.map(row => ({ ...row, reasonTitle: reasonTitle(row.reasonCode) })),
      items,
      battles,
      clan,
      resources: resources.map(row => ({
        code: row.template.code,
        name: row.template.name,
        amount: row.amount,
        reserved: row.reservedAmount,
        // Стоимость запаса по базовой цене: сто единиц металлолома и сто
        // единиц спирта — совсем разные состояния.
        worth: row.amount * row.template.basePrice,
      })),
      professions: professions.map(row => ({
        code: row.professionCode,
        name: PROFESSION_NAMES[row.professionCode as ProfessionCode] ?? row.professionCode,
        level: row.level,
        exp: row.exp,
      })),
      shifts: shifts.map(row => ({
        id: row.id,
        status: row.status,
        statusTitle: SHIFT_STATUS[row.status] ?? row.status,
        objectName: row.productionObject.name,
        startedAt: row.startedAt,
        endsAt: row.endsAt,
      })),
      adminActions,
      upgrades: upgrades.map(row => ({ result: row.result, count: row._count })),
    })
  })

  /**
   * Выдача и списание опыта.
   *
   * Знак задаёт направление, как у денег: две ручки вместо одной
   * разошлись бы правилами, а правило тут одно — обе обратимы.
   *
   * Уровень пересчитывается исполнителем, поэтому выдать опыт и забыть
   * поднять уровень нельзя.
   */
  fastify.post<{ Params: { id: string } }>('/players/:id/exp', GRANT_ADMIN, async (req, reply) => {
    const parsed = z.object({
      track: z.enum(['battle', 'economic', 'production']),
      amount: z.number().int().refine(value => value !== 0, 'Ноль ничего не меняет')
        .refine(value => Math.abs(value) <= 1_000_000, 'Не больше миллиона за раз'),
      reason: REASON,
    }).safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: validationMessage(parsed.error), details: parsed.error.flatten() })
    }
    const character = await prisma.character.findUnique({
      where: { id: req.params.id }, select: { id: true },
    })
    if (!character) return reply.code(404).send({ code: 'GEN_002', message: 'Персонаж не найден' })

    const { track, amount, reason } = parsed.data
    const giving = amount > 0
    const payload = { characterId: character.id, track, amount: Math.abs(amount) }
    const action = await AdminActionsService.perform(admin(req), reason, {
      kind: giving ? 'GRANT_EXP' : 'TAKE_EXP',
      targetType: 'character',
      targetId: character.id,
      payload,
      undo: { kind: giving ? 'TAKE_EXP' : 'GRANT_EXP', payload },
    })
    return reply.send({ actionId: action.actionId })
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
