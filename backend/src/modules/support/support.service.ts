// =============================================================
// Поддержка тикетами (правка 29.10: «нормальная поддержка, удобно и
// функционально»; до этого — одна форма и один ответ, правка 21.10).
//
// Обращение — тема, категория и переписка в обе стороны. Игрок может
// дописать, закрыть и оценить ответ; поддержка — ответить, оставить
// заметку для своих (игрок её не видит), взять обращение на себя,
// поменять приоритет и категорию. Новое от игрока уходит администрации
// в Telegram, ответ поддержки приходит игроку уведомлением.
//
// Статусы: OPEN — ждёт поддержку, ANSWERED — ждёт игрока, CLOSED — закрыто.
// =============================================================
import type { Prisma, SupportCategory, SupportPriority, SupportStatus } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { logger } from '../../shared/logger/logger'
import { NoticesService } from '../chat/notices.service'
import { sendTelegram } from '../admin-balance/telegram.service'

export const SUPPORT = {
  subjectMax: 120,
  textMax: 2000,
  /** Клиент ужимает скриншот в JPEG до 1600 px. Весь запрос должен уложиться
      в 1 МБ — лимит nginx на сервере по умолчанию. */
  imageMaxBytes: 700_000,
  /** Обращений, ждущих поддержку, у одного игрока — не больше. */
  openMax: 3,
  /** Новых обращений за сутки — не больше: форму не заливают. */
  perDayMax: 10,
  /** Сообщений игрока подряд без ответа поддержки. */
  streakMax: 5,
  /** Закрытое обращение можно открыть снова своим сообщением в течение двух недель. */
  reopenDays: 14,
  adminPage: 50,
} as const

export const CATEGORIES: SupportCategory[] = ['BUG', 'PAYMENT', 'ITEMS', 'ACCOUNT', 'COMPLAINT', 'QUESTION', 'IDEA', 'OTHER']
const CATEGORY_LABEL: Record<SupportCategory, string> = {
  BUG: 'Ошибка в игре', PAYMENT: 'Оплата и доллары', ITEMS: 'Вещи и деньги', ACCOUNT: 'Аккаунт и вход',
  COMPLAINT: 'Жалоба на игрока', QUESTION: 'Вопрос по игре', IDEA: 'Предложение', OTHER: 'Другое',
}

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/

const TICKET_FIELDS = {
  id: true, number: true, subject: true, category: true, priority: true, status: true,
  assignedTo: true, lastMessageAt: true, createdAt: true, closedAt: true, closedBy: true,
  rating: true, playerUnread: true, staffUnread: true,
} as const

const MESSAGE_FIELDS = {
  id: true, author: true, authorLabel: true, text: true, imageMime: true, internal: true, createdAt: true,
} as const

type MessageRow = Prisma.SupportMessageGetPayload<{ select: typeof MESSAGE_FIELDS }>

function plainMessage({ imageMime, ...rest }: MessageRow) {
  return { ...rest, hasImage: !!imageMime }
}

function cleanText(text: string, empty: string) {
  const body = text.trim()
  if (!body) throw new AppError(ErrorCode.VALIDATION_ERROR, empty, 422)
  if (body.length > SUPPORT.textMax) throw new AppError(ErrorCode.VALIDATION_ERROR, `Текст — не длиннее ${SUPPORT.textMax} знаков`, 422)
  return body
}

function parseImage(dataUrl?: string | null) {
  if (!dataUrl) return null
  const parsed = DATA_URL.exec(dataUrl)
  if (!parsed) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Скриншот: картинка PNG, JPEG или WebP', 422)
  if (Buffer.byteLength(parsed[2], 'base64') > SUPPORT.imageMaxBytes) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Скриншот слишком большой: не больше 700 КБ', 422)
  }
  return { mime: parsed[1], data: parsed[2] }
}

const notFound = () => new AppError(ErrorCode.NOT_FOUND, 'Обращение не найдено', 404)

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Администрации в Telegram — без ожидания: упавший бот не мешает игроку. */
function tellStaff(text: string) {
  void sendTelegram(text).catch(err => logger.warn({ err }, '[Support] telegram skipped'))
}

async function ownTicket(characterId: string, ticketId: string) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { ...TICKET_FIELDS, characterId: true } })
  // Чужое обращение для игрока не существует — тот же ответ, что и на несуществующее.
  if (!ticket || ticket.characterId !== characterId) throw notFound()
  return ticket
}

export interface AdminListFilter {
  status?: SupportStatus
  category?: SupportCategory
  /** 'me' — мои, 'none' — ничьи. */
  assigned?: 'me' | 'none'
  q?: string
  page?: number
}

export const SupportService = {
  // ── Игрок ──────────────────────────────────────────────────

  async create(characterId: string, input: { subject: string; category?: SupportCategory; text: string; image?: string | null }) {
    const subject = input.subject.trim().replace(/\s+/g, ' ')
    if (!subject) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Напишите тему обращения', 422)
    if (subject.length > SUPPORT.subjectMax) throw new AppError(ErrorCode.VALIDATION_ERROR, `Тема — не длиннее ${SUPPORT.subjectMax} знаков`, 422)
    const text = cleanText(input.text, 'Опишите, что случилось')
    const image = parseImage(input.image)
    const category = input.category ?? 'OTHER'

    const [open, today] = await Promise.all([
      prisma.supportTicket.count({ where: { characterId, status: 'OPEN' } }),
      prisma.supportTicket.count({ where: { characterId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    ])
    if (open >= SUPPORT.openMax) {
      throw new AppError(ErrorCode.RATE_LIMITED, 'У вас уже есть обращения, которые ждут ответа, — дождитесь его или допишите в них', 429)
    }
    if (today >= SUPPORT.perDayMax) throw new AppError(ErrorCode.RATE_LIMITED, 'Слишком много обращений за сутки — допишите в уже открытые', 429)

    const ticket = await prisma.supportTicket.create({
      data: {
        characterId, subject, category,
        messages: { create: { author: 'PLAYER', text, imageData: image?.data ?? null, imageMime: image?.mime ?? null } },
      },
      select: { ...TICKET_FIELDS, character: { select: { nickname: true } } },
    })
    tellStaff(`Новое обращение №${ticket.number} от ${escapeHtml(ticket.character.nickname)} · ${CATEGORY_LABEL[category]}${image ? ' · со скриншотом' : ''}\n<b>${escapeHtml(subject)}</b>\n${escapeHtml(text.slice(0, 500))}`)
    const { character: _c, ...row } = ticket
    void _c
    return row
  },

  async mine(characterId: string) {
    const rows = await prisma.supportTicket.findMany({
      where: { characterId }, orderBy: { lastMessageAt: 'desc' }, take: 50,
      select: { ...TICKET_FIELDS, messages: { where: { internal: false }, orderBy: { createdAt: 'desc' }, take: 1, select: { author: true, text: true } } },
    })
    return {
      items: rows.map(({ messages, staffUnread: _s, assignedTo: _a, priority: _p, ...row }) => {
        void _s; void _a; void _p
        return { ...row, last: messages[0] ? { author: messages[0].author, text: messages[0].text.slice(0, 140) } : null }
      }),
      unread: rows.filter(row => row.playerUnread).length,
    }
  },

  async unread(characterId: string) {
    return { count: await prisma.supportTicket.count({ where: { characterId, playerUnread: true } }) }
  },

  /** Переписка для игрока — без заметок поддержки. Открыл — прочитал. */
  async thread(characterId: string, ticketId: string) {
    const ticket = await ownTicket(characterId, ticketId)
    const messages = await prisma.supportMessage.findMany({
      where: { ticketId, internal: false }, orderBy: { createdAt: 'asc' }, select: MESSAGE_FIELDS,
    })
    if (ticket.playerUnread) await prisma.supportTicket.update({ where: { id: ticketId }, data: { playerUnread: false } })
    const { staffUnread: _s, characterId: _c, priority: _p, ...row } = ticket
    void _s; void _c; void _p
    return {
      ticket: { ...row, playerUnread: false, canReopen: canReopen(ticket) },
      messages: messages.map(m => {
        const { internal: _i, ...rest } = plainMessage(m)
        void _i
        return rest
      }),
    }
  },

  async playerMessage(characterId: string, ticketId: string, input: { text: string; image?: string | null }) {
    const ticket = await ownTicket(characterId, ticketId)
    const text = cleanText(input.text, 'Напишите сообщение')
    const image = parseImage(input.image)
    if (ticket.status === 'CLOSED' && !canReopen(ticket)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Обращение закрыто давно — создайте новое', 409)
    }
    const recent = await prisma.supportMessage.findMany({
      where: { ticketId, internal: false, author: { not: 'SYSTEM' } }, orderBy: { createdAt: 'desc' }, take: SUPPORT.streakMax, select: { author: true },
    })
    if (recent.length >= SUPPORT.streakMax && recent.every(m => m.author === 'PLAYER')) {
      throw new AppError(ErrorCode.RATE_LIMITED, 'Дождитесь ответа поддержки — мы видим все ваши сообщения', 429)
    }
    const reopened = ticket.status === 'CLOSED'
    const now = new Date()
    await prisma.$transaction([
      ...(reopened ? [prisma.supportMessage.create({ data: { ticketId, author: 'SYSTEM', text: 'Игрок открыл обращение снова', createdAt: now } })] : []),
      prisma.supportMessage.create({
        data: { ticketId, author: 'PLAYER', text, imageData: image?.data ?? null, imageMime: image?.mime ?? null, createdAt: new Date(now.getTime() + 1) },
      }),
      prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'OPEN', staffUnread: true, lastMessageAt: now, ...(reopened ? { closedAt: null, closedBy: null, rating: null } : {}) },
      }),
    ])
    const who = await prisma.character.findUnique({ where: { id: characterId }, select: { nickname: true } })
    tellStaff(`${reopened ? 'Открыто снова' : 'Игрок дописал в'} обращение №${ticket.number} (${escapeHtml(who?.nickname ?? '')})\n<b>${escapeHtml(ticket.subject)}</b>\n${escapeHtml(text.slice(0, 500))}`)
    return this.thread(characterId, ticketId)
  },

  async playerClose(characterId: string, ticketId: string) {
    const ticket = await ownTicket(characterId, ticketId)
    if (ticket.status !== 'CLOSED') {
      await prisma.$transaction([
        prisma.supportMessage.create({ data: { ticketId, author: 'SYSTEM', text: 'Игрок закрыл обращение' } }),
        prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'CLOSED', closedAt: new Date(), closedBy: 'игрок', staffUnread: false } }),
      ])
    }
    return this.thread(characterId, ticketId)
  },

  async rate(characterId: string, ticketId: string, rating: number) {
    const ticket = await ownTicket(characterId, ticketId)
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Оценка от 1 до 5', 422)
    if (ticket.status !== 'CLOSED') throw new AppError(ErrorCode.VALIDATION_ERROR, 'Оценить можно закрытое обращение', 409)
    await prisma.supportTicket.update({ where: { id: ticketId }, data: { rating } })
    if (rating <= 2) tellStaff(`Низкая оценка ${rating}/5 по обращению №${ticket.number}: ${escapeHtml(ticket.subject)}`)
    return this.thread(characterId, ticketId)
  },

  /** Скриншот из переписки: игрок видит только свои обращения и не видит заметок. */
  async playerImage(characterId: string, ticketId: string, messageId: string) {
    await ownTicket(characterId, ticketId)
    return readImage({ id: messageId, ticketId, internal: false })
  },

  // ── Поддержка ──────────────────────────────────────────────

  async adminList(filter: AdminListFilter, adminLabel: string) {
    const where: Prisma.SupportTicketWhereInput = {
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.assigned === 'me' ? { assignedTo: adminLabel } : filter.assigned === 'none' ? { assignedTo: null } : {}),
    }
    const q = filter.q?.trim().replace(/^[#№]/, '')
    if (q) {
      where.OR = /^\d+$/.test(q)
        ? [{ number: Number(q) }]
        : [{ subject: { contains: q, mode: 'insensitive' } }, { character: { nickname: { contains: q, mode: 'insensitive' } } }]
    }
    const page = Math.max(0, filter.page ?? 0)
    const listWhere = { ...where, ...(filter.status ? { status: filter.status } : {}) }
    const [rows, total, byStatus, unread] = await Promise.all([
      prisma.supportTicket.findMany({
        where: listWhere,
        // Ждущие ответа — сначала срочные, потом самые давние; остальное — свежие сверху.
        orderBy: filter.status === 'OPEN' ? [{ priority: 'desc' }, { lastMessageAt: 'asc' }] : [{ lastMessageAt: 'desc' }],
        skip: page * SUPPORT.adminPage, take: SUPPORT.adminPage,
        select: {
          ...TICKET_FIELDS, characterId: true,
          character: { select: { nickname: true, battleLevel: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { author: true, text: true, internal: true } },
          _count: { select: { messages: true } },
        },
      }),
      prisma.supportTicket.count({ where: listWhere }),
      prisma.supportTicket.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.supportTicket.count({ where: { ...where, staffUnread: true, status: { not: 'CLOSED' } } }),
    ])
    const counts: Record<SupportStatus, number> = { OPEN: 0, ANSWERED: 0, CLOSED: 0 }
    for (const row of byStatus) counts[row.status] = row._count._all
    return {
      items: rows.map(({ messages, _count, ...row }) => ({
        ...row, messagesCount: _count.messages,
        last: messages[0] ? { author: messages[0].author, internal: messages[0].internal, text: messages[0].text.slice(0, 160) } : null,
      })),
      total, counts, unread, page, pageSize: SUPPORT.adminPage,
    }
  },

  /** Вся переписка с заметками и карточка игрока. Открыл — прочитал. */
  async adminThread(ticketId: string) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: {
        ...TICKET_FIELDS,
        character: {
          select: {
            id: true, nickname: true, battleLevel: true, money: true, dollars: true, isPremium: true, createdAt: true, lastActiveAt: true,
            user: { select: { login: true, email: true } },
          },
        },
        messages: { orderBy: { createdAt: 'asc' }, select: MESSAGE_FIELDS },
      },
    })
    if (!ticket) throw notFound()
    if (ticket.staffUnread) await prisma.supportTicket.update({ where: { id: ticketId }, data: { staffUnread: false } })
    const others = await prisma.supportTicket.findMany({
      where: { characterId: ticket.character.id, id: { not: ticketId } },
      orderBy: { createdAt: 'desc' }, take: 10,
      select: { id: true, number: true, subject: true, status: true, createdAt: true },
    })
    const { messages, character, ...row } = ticket
    const { user, ...player } = character
    return {
      ticket: { ...row, staffUnread: false },
      player: { ...player, login: user.login, email: user.email },
      others,
      messages: messages.map(plainMessage),
    }
  },

  async adminMessage(ticketId: string, adminLabel: string, input: { text: string; internal?: boolean; close?: boolean }) {
    const text = cleanText(input.text, 'Пустой ответ')
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { ...TICKET_FIELDS, characterId: true } })
    if (!ticket) throw notFound()
    const now = new Date()
    if (input.internal) {
      await prisma.supportMessage.create({ data: { ticketId, author: 'STAFF', authorLabel: adminLabel, text, internal: true } })
      return this.adminThread(ticketId)
    }
    const close = !!input.close
    await prisma.$transaction([
      prisma.supportMessage.create({ data: { ticketId, author: 'STAFF', authorLabel: adminLabel, text, createdAt: now } }),
      ...(close ? [prisma.supportMessage.create({ data: { ticketId, author: 'SYSTEM', text: 'Поддержка закрыла обращение', createdAt: new Date(now.getTime() + 1) } })] : []),
      prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: close ? 'CLOSED' : 'ANSWERED', playerUnread: true, staffUnread: false, lastMessageAt: now,
          // Ответил — значит, взял: остальные видят, кто ведёт обращение.
          assignedTo: ticket.assignedTo ?? adminLabel,
          ...(close ? { closedAt: now, closedBy: adminLabel } : {}),
        },
      }),
    ])
    await NoticesService.push(ticket.characterId, `Поддержка ответила на обращение №${ticket.number} «${ticket.subject}». Откройте Поддержку, чтобы прочитать.`)
    return this.adminThread(ticketId)
  },

  async adminUpdate(ticketId: string, adminLabel: string, patch: {
    status?: SupportStatus; priority?: SupportPriority; category?: SupportCategory; assign?: 'me' | 'none'
  }) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { ...TICKET_FIELDS, characterId: true } })
    if (!ticket) throw notFound()
    const data: Prisma.SupportTicketUpdateInput = {}
    const notes: string[] = []
    if (patch.priority && patch.priority !== ticket.priority) data.priority = patch.priority
    if (patch.category && patch.category !== ticket.category) data.category = patch.category
    if (patch.assign) data.assignedTo = patch.assign === 'me' ? adminLabel : null
    if (patch.status && patch.status !== ticket.status) {
      data.status = patch.status
      if (patch.status === 'CLOSED') {
        Object.assign(data, { closedAt: new Date(), closedBy: adminLabel, playerUnread: true, staffUnread: false })
        notes.push('Поддержка закрыла обращение')
      } else {
        Object.assign(data, { closedAt: null, closedBy: null })
        if (ticket.status === 'CLOSED') notes.push('Поддержка открыла обращение снова')
      }
    }
    await prisma.$transaction([
      ...notes.map(text => prisma.supportMessage.create({ data: { ticketId, author: 'SYSTEM', text } })),
      prisma.supportTicket.update({ where: { id: ticketId }, data }),
    ])
    if (patch.status === 'CLOSED' && ticket.status !== 'CLOSED') {
      await NoticesService.push(ticket.characterId, `Обращение №${ticket.number} «${ticket.subject}» закрыто. Оцените, пожалуйста, ответ в Поддержке.`)
    }
    return this.adminThread(ticketId)
  },

  async adminImage(ticketId: string, messageId: string) {
    return readImage({ id: messageId, ticketId })
  },
}

function canReopen(ticket: { status: SupportStatus; closedAt: Date | null }) {
  return ticket.status === 'CLOSED' && !!ticket.closedAt && Date.now() - ticket.closedAt.getTime() < SUPPORT.reopenDays * 86_400_000
}

async function readImage(where: Prisma.SupportMessageWhereInput) {
  const row = await prisma.supportMessage.findFirst({ where, select: { imageData: true, imageMime: true } })
  if (!row?.imageData || !row.imageMime) return null
  return { mime: row.imageMime, bytes: Buffer.from(row.imageData, 'base64') }
}
