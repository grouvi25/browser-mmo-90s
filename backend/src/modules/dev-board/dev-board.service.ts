// =============================================================
// ДОСКА РАЗРАБОТЧИКОВ
//
// Закрытая группа в Telegram (тот же бот, что шлёт алерты): обращения
// игроков и свои задачи приходят карточками с кнопками «Беру», «Готово»,
// «Отпустить». Нейронки разработчиков видят ту же доску через закрытый
// адрес с ключом (dev-board.routes.ts). В админке доски нет: её видят
// только разработчики, у кого есть группа и ключ.
//
// Без DEV_BOARD_CHAT_ID и DEV_BOARD_TOKEN модуль молчит: обращения и
// алерты работают как раньше.
// =============================================================
import { createHash } from 'node:crypto'
import type { DevBoardItem } from '@prisma/client'
import { env } from '../../config/env'
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { logger } from '../../shared/logger/logger'

export function devBoardConfigured(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.DEV_BOARD_CHAT_ID && env.DEV_BOARD_TOKEN)
}

/** Секрет вебхука Telegram: из ключа доски, только [a-f0-9]. */
export function devBoardWebhookSecret(): string {
  return createHash('sha256').update(`tg-webhook:${env.DEV_BOARD_TOKEN ?? ''}`).digest('hex')
}

/** «GroYvi=Миша,M1DAS984=Егор» → имя по нику в Telegram. */
export function devName(from: { username?: string; first_name?: string } | undefined): string {
  const names = new Map((env.DEV_BOARD_NAMES ?? '').split(',').map(pair => pair.split('=').map(part => part.trim()) as [string, string]).filter(([k, v]) => k && v))
  const nick = from?.username ?? ''
  return names.get(nick) ?? names.get(`@${nick}`) ?? from?.first_name ?? (nick || 'кто-то')
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: T; description?: string }> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    const json = await response.json().catch(() => ({ ok: false })) as { ok: boolean; result?: T; description?: string }
    if (!json.ok) logger.warn({ method, description: json.description }, '[DevBoard] Telegram отказал')
    return json
  } catch (err) {
    logger.warn({ err, method }, '[DevBoard] Telegram недоступен')
    return { ok: false }
  }
}

const label = (item: DevBoardItem) => (item.ticketNumber ? `Обращение №${item.ticketNumber}` : `Задача ${item.id}`)

function statusLine(item: DevBoardItem): string {
  if (item.status === 'TAKEN') return `🔧 в работе: <b>${escape(item.takenBy ?? '')}</b>`
  if (item.status === 'DONE') return `✅ готово${item.doneBy ? `: ${escape(item.doneBy)}` : ''}`
  return '🟡 свободно'
}

function cardText(item: DevBoardItem): string {
  return [
    `<b>${label(item)}</b> · ${escape(item.title)}`,
    item.note ? escape(item.note) : '',
    statusLine(item),
  ].filter(Boolean).join('\n\n')
}

function keyboard(item: DevBoardItem) {
  if (item.status === 'OPEN') return { inline_keyboard: [[{ text: 'Беру', callback_data: `take:${item.id}` }]] }
  if (item.status === 'TAKEN') return { inline_keyboard: [[{ text: 'Готово', callback_data: `done:${item.id}` }, { text: 'Отпустить', callback_data: `free:${item.id}` }]] }
  return { inline_keyboard: [[{ text: 'Вернуть в работу', callback_data: `free:${item.id}` }]] }
}

/** Карточка в группе: новая — отправить, есть — обновить на месте. */
async function render(item: DevBoardItem): Promise<void> {
  if (!devBoardConfigured()) return
  const body = { chat_id: env.DEV_BOARD_CHAT_ID, text: cardText(item), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard(item) }
  if (item.messageId) {
    const edited = await tg('editMessageText', { ...body, message_id: item.messageId })
    // «message is not modified» — не ошибка; удалённую карточку шлём заново.
    if (edited.ok || /not modified/i.test(edited.description ?? '')) return
  }
  const sent = await tg<{ message_id: number }>('sendMessage', body)
  if (sent.ok && sent.result) await prisma.devBoardItem.update({ where: { id: item.id }, data: { messageId: sent.result.message_id } })
}

const snippet = (text: string, max = 400) => (text.length > max ? `${text.slice(0, max)}…` : text)

const safe = (work: () => Promise<unknown>) => { if (devBoardConfigured()) void work().catch(err => logger.warn({ err }, '[DevBoard] пропущено')) }

export const DevBoard = {
  // ── Хуки из поддержки ─────────────────────────────────────
  ticketCreated(ticket: { number: number; nickname: string; subject: string; text: string; hasImage: boolean }) {
    safe(async () => {
      const item = await prisma.devBoardItem.upsert({
        where: { ticketNumber: ticket.number },
        update: {},
        create: { ticketNumber: ticket.number, title: `${ticket.nickname} · ${ticket.subject}`, note: snippet(ticket.text) + (ticket.hasImage ? '\n(есть скриншот)' : '') },
      })
      await render(item)
    })
  },

  ticketMessage(ticket: { number: number; nickname: string; subject: string; text: string; reopened: boolean }) {
    safe(async () => {
      let item = await prisma.devBoardItem.upsert({
        where: { ticketNumber: ticket.number },
        update: {},
        create: { ticketNumber: ticket.number, title: `${ticket.nickname} · ${ticket.subject}`, note: snippet(ticket.text) },
      })
      if (item.status === 'DONE') item = await prisma.devBoardItem.update({ where: { id: item.id }, data: { status: 'OPEN', takenBy: null, doneBy: null } })
      await render(item)
      await tg('sendMessage', {
        chat_id: env.DEV_BOARD_CHAT_ID, parse_mode: 'HTML',
        text: `${ticket.reopened ? 'Игрок открыл снова' : 'Игрок дописал в'} №${ticket.number}:\n${escape(snippet(ticket.text))}`,
        ...(item.messageId ? { reply_to_message_id: item.messageId, allow_sending_without_reply: true } : {}),
      })
    })
  },

  ticketClosed(number: number, by: string) {
    safe(async () => {
      const item = await prisma.devBoardItem.findUnique({ where: { ticketNumber: number } })
      if (!item || item.status === 'DONE') return
      await render(await prisma.devBoardItem.update({ where: { id: item.id }, data: { status: 'DONE', doneBy: item.takenBy ?? by } }))
    })
  },

  ticketReopened(number: number) {
    safe(async () => {
      const item = await prisma.devBoardItem.findUnique({ where: { ticketNumber: number } })
      if (!item || item.status !== 'DONE') return
      await render(await prisma.devBoardItem.update({ where: { id: item.id }, data: { status: 'OPEN', takenBy: null, doneBy: null } }))
    })
  },

  // ── Действия (кнопки в группе и нейронки) ────────────────
  async take(id: number, who: string) {
    const item = await prisma.devBoardItem.findUnique({ where: { id } })
    if (!item) throw new AppError(ErrorCode.NOT_FOUND, 'Нет такой карточки', 404)
    if (item.status === 'DONE') throw new AppError(ErrorCode.CONFLICT, 'Уже готово', 409)
    if (item.status === 'TAKEN' && item.takenBy !== who) throw new AppError(ErrorCode.CONFLICT, `Уже взял ${item.takenBy}`, 409)
    // Условие в where: двое нажали одновременно — возьмёт один.
    const changed = await prisma.devBoardItem.updateMany({ where: { id, OR: [{ status: 'OPEN' }, { takenBy: who }] }, data: { status: 'TAKEN', takenBy: who } })
    if (changed.count !== 1) throw new AppError(ErrorCode.CONFLICT, 'Только что взял кто-то другой', 409)
    const next = await prisma.devBoardItem.findUniqueOrThrow({ where: { id } })
    await render(next)
    return next
  },

  async done(id: number, who: string) {
    const item = await prisma.devBoardItem.findUnique({ where: { id } })
    if (!item) throw new AppError(ErrorCode.NOT_FOUND, 'Нет такой карточки', 404)
    const next = await prisma.devBoardItem.update({ where: { id }, data: { status: 'DONE', doneBy: who, takenBy: item.takenBy ?? who } })
    await render(next)
    return next
  },

  async free(id: number) {
    const item = await prisma.devBoardItem.findUnique({ where: { id } })
    if (!item) throw new AppError(ErrorCode.NOT_FOUND, 'Нет такой карточки', 404)
    const next = await prisma.devBoardItem.update({ where: { id }, data: { status: 'OPEN', takenBy: null, doneBy: null } })
    await render(next)
    return next
  },

  async addTask(title: string, who: string, note?: string) {
    const clean = title.trim().replace(/\s+/g, ' ').slice(0, 300)
    if (!clean) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Пустая задача', 422)
    const item = await prisma.devBoardItem.create({ data: { title: clean, note: note?.trim().slice(0, 2000) || null, createdBy: who } })
    await render(item)
    return item
  },

  /** Вся доска: незакрытые обращения без карточки заводятся сразу (они могли прийти до доски). */
  async list() {
    const open = await prisma.supportTicket.findMany({
      where: { status: { not: 'CLOSED' } },
      select: { number: true, subject: true, character: { select: { nickname: true } }, messages: { where: { author: 'PLAYER' }, orderBy: { createdAt: 'asc' }, take: 1, select: { text: true } } },
    })
    for (const ticket of open) {
      await prisma.devBoardItem.upsert({
        where: { ticketNumber: ticket.number },
        update: {},
        create: { ticketNumber: ticket.number, title: `${ticket.character.nickname} · ${ticket.subject}`, note: snippet(ticket.messages[0]?.text ?? '') },
      })
    }
    const active = await prisma.devBoardItem.findMany({ where: { status: { not: 'DONE' } }, orderBy: { id: 'asc' } })
    const recent = await prisma.devBoardItem.findMany({ where: { status: 'DONE' }, orderBy: { updatedAt: 'desc' }, take: 15 })
    return { active, recentDone: recent }
  },

  /** Текст для /board в группе. */
  async boardText(): Promise<string> {
    const { active } = await this.list()
    if (!active.length) return 'На доске пусто.'
    const free = active.filter(item => item.status === 'OPEN')
    const taken = active.filter(item => item.status === 'TAKEN')
    const line = (item: DevBoardItem) => `• ${label(item)} (id ${item.id}) · ${escape(item.title)}`
    return [
      free.length ? `<b>Свободно</b>\n${free.map(line).join('\n')}` : '',
      taken.length ? `<b>В работе</b>\n${taken.map(item => `${line(item)} · ${escape(item.takenBy ?? '')}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n')
  },

  /** Обращение целиком для нейронки: переписка и скриншоты. */
  async ticket(number: number) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { number },
      select: {
        id: true, number: true, subject: true, status: true, category: true, createdAt: true,
        character: { select: { nickname: true } },
        messages: { orderBy: { createdAt: 'asc' }, select: { author: true, authorLabel: true, text: true, internal: true, createdAt: true, imageMime: true, imageData: true } },
      },
    })
    if (!ticket) throw new AppError(ErrorCode.NOT_FOUND, 'Обращение не найдено', 404)
    const board = await prisma.devBoardItem.findUnique({ where: { ticketNumber: number } })
    return {
      ...ticket,
      board,
      messages: ticket.messages.map(({ imageMime, imageData, ...m }) => ({ ...m, image: imageMime && imageData ? `data:${imageMime};base64,${imageData}` : null })),
    }
  },

  /** Ответ игроку от имени поддержки; close — сразу закрыть. Карточка уходит в «готово». */
  async reply(number: number, text: string, close: boolean, who: string) {
    const ticket = await prisma.supportTicket.findUnique({ where: { number }, select: { id: true } })
    if (!ticket) throw new AppError(ErrorCode.NOT_FOUND, 'Обращение не найдено', 404)
    // Поддержка импортирует доску: здесь — поздний импорт, без кольца модулей.
    const { SupportService } = await import('../support/support.service')
    await SupportService.adminMessage(ticket.id, 'Поддержка', { text, close })
    const item = await prisma.devBoardItem.findUnique({ where: { ticketNumber: number } })
    if (item && close) await this.done(item.id, item.takenBy ?? who)
    return { ok: true }
  },
}
