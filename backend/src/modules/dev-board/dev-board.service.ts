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
import { ICONS, cardHtml, summaryHtml, type Icons } from './dev-board.cards'

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

// ── Настройки доски: темы группы, сводка, запасные значки ──────────
type BoardSettings = { ticketsTopic?: number; tasksTopic?: number; summaryId?: number; noIcons?: boolean }
const SETTINGS_KEY = 'dev_board'

async function settings(): Promise<BoardSettings> {
  const row = await prisma.siteSetting.findUnique({ where: { key: SETTINGS_KEY } })
  return (row?.value as BoardSettings | undefined) ?? {}
}
async function saveSettings(patch: BoardSettings): Promise<BoardSettings> {
  const next = { ...(await settings()), ...patch }
  await prisma.siteSetting.upsert({ where: { key: SETTINGS_KEY }, update: { value: next }, create: { key: SETTINGS_KEY, value: next } })
  return next
}

/** Темы «Обращения» и «Задачи». Нет прав на темы — всё идёт в общую. Создали впервые — старые карточки переезжают. */
async function ensureTopics(): Promise<BoardSettings> {
  const current = await settings()
  if (current.ticketsTopic && current.tasksTopic) return current
  const make = async (name: string, color: number) => (await tg<{ message_thread_id: number }>('createForumTopic', { chat_id: env.DEV_BOARD_CHAT_ID, name, icon_color: color })).result?.message_thread_id
  const ticketsTopic = current.ticketsTopic ?? await make('Обращения', 0x6FB9F0)
  const tasksTopic = current.tasksTopic ?? await make('Задачи', 0xFFD67E)
  if (!ticketsTopic || !tasksTopic) {
    if (ticketsTopic || tasksTopic) await saveSettings({ ticketsTopic, tasksTopic })
    return current
  }
  const next = await saveSettings({ ticketsTopic, tasksTopic })
  // Переезд: старые карточки из общей темы убираем, активные пришлём в свои темы.
  const old = await prisma.devBoardItem.findMany({ where: { messageId: { not: null } } })
  for (const item of old) await tg('deleteMessage', { chat_id: env.DEV_BOARD_CHAT_ID, message_id: item.messageId })
  await prisma.devBoardItem.updateMany({ where: { messageId: { not: null } }, data: { messageId: null } })
  for (const item of await prisma.devBoardItem.findMany({ where: { status: { not: 'DONE' } }, orderBy: { id: 'asc' } })) await render(item)
  return next
}

const ICON_ERRORS = /not modified|not found|can't be edited|can't be deleted|MESSAGE_ID_INVALID/i

/** Rich-сообщение со значками; не приняли значки — то же без них, и больше не пробуем. */
async function richCall<T>(method: string, base: Record<string, unknown>, html: (icons: Icons) => string) {
  const s = await settings()
  const body = (icons: Icons) => ({ ...base, rich_message: { html: html(icons), skip_entity_detection: true } })
  const first = await tg<T>(method, body(s.noIcons ? {} : ICONS))
  if (first.ok || s.noIcons || ICON_ERRORS.test(first.description ?? '')) return first
  const plain = await tg<T>(method, body({}))
  if (plain.ok) await saveSettings({ noIcons: true })
  return plain
}

const REACTION: Record<string, string | null> = { OPEN: null, TAKEN: '👨‍💻', DONE: '💯' }

/** Админка на поддомене: https://admin.<домен игры>/support?ticket=<id>. */
async function adminUrl(item: DevBoardItem): Promise<string | null> {
  if (!item.ticketNumber) return null
  const ticket = await prisma.supportTicket.findUnique({ where: { number: item.ticketNumber }, select: { id: true } })
  if (!ticket) return null
  try {
    const url = new URL(env.APP_URL)
    url.hostname = `admin.${url.hostname}`
    return `${url.origin}/support?ticket=${ticket.id}`
  } catch {
    return null
  }
}

/** Скриншот из обращения — фото ответом на карточку в теме «Обращения». */
async function sendShot(item: DevBoardItem, image: { mime: string; data: string }, caption: string): Promise<void> {
  const topic = (await settings()).ticketsTopic
  const ext = image.mime === 'image/png' ? 'png' : image.mime === 'image/webp' ? 'webp' : 'jpg'
  const form = new FormData()
  form.set('chat_id', String(env.DEV_BOARD_CHAT_ID))
  if (topic) form.set('message_thread_id', String(topic))
  if (item.messageId) form.set('reply_parameters', JSON.stringify({ message_id: item.messageId, allow_sending_without_reply: true }))
  form.set('caption', caption)
  form.set('photo', new Blob([new Uint8Array(Buffer.from(image.data, 'base64'))], { type: image.mime }), `screenshot.${ext}`)
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) })
    if (!response.ok) logger.warn({ status: response.status, body: (await response.text().catch(() => '')).slice(0, 200) }, '[DevBoard] скриншот не ушёл')
  } catch (err) {
    logger.warn({ err }, '[DevBoard] скриншот не ушёл')
  }
}

/** Карточка в своей теме: новая — отправить, есть — поправить на месте. */
async function render(item: DevBoardItem): Promise<void> {
  if (!devBoardConfigured()) return
  const s = await ensureTopics()
  // Перенос в темы мог уже прислать эту карточку заново: берём свежий номер сообщения.
  item = (await prisma.devBoardItem.findUnique({ where: { id: item.id } })) ?? item
  const chat = env.DEV_BOARD_CHAT_ID!
  const url = await adminUrl(item)
  let messageId = item.messageId
  if (messageId) {
    const edited = await richCall('editMessageText', { chat_id: chat, message_id: messageId }, icons => cardHtml(item, icons, url))
    if (!edited.ok && !/not modified/i.test(edited.description ?? '')) {
      // Старое простое сообщение или удалено: убираем и шлём заново.
      await tg('deleteMessage', { chat_id: chat, message_id: messageId })
      messageId = null
    }
  }
  if (!messageId) {
    const topic = item.ticketNumber ? s.ticketsTopic : s.tasksTopic
    const sent = await richCall<{ message_id: number }>('sendRichMessage', { chat_id: chat, ...(topic ? { message_thread_id: topic } : {}) }, icons => cardHtml(item, icons, url))
    if (!sent.ok || !sent.result) return
    messageId = sent.result.message_id
    await prisma.devBoardItem.update({ where: { id: item.id }, data: { messageId } })
  }
  const emoji = REACTION[item.status]
  await tg('setMessageReaction', { chat_id: chat, message_id: messageId, reaction: emoji ? [{ type: 'emoji', emoji }] : [] })
  scheduleSummary()
}

// ── Закреплённая сводка в общей теме ──────────────────────────────
let summaryTimer: NodeJS.Timeout | null = null
let summaryRunning: Promise<void> = Promise.resolve()
function scheduleSummary() {
  if (summaryTimer) clearTimeout(summaryTimer)
  summaryTimer = setTimeout(() => {
    summaryTimer = null
    summaryRunning = summaryRunning.then(() => refreshSummary(false)).catch(err => logger.warn({ err }, '[DevBoard] сводка'))
  }, 1500)
}

async function refreshSummary(toBottom: boolean): Promise<void> {
  if (!devBoardConfigured()) return
  const chat = env.DEV_BOARD_CHAT_ID!
  const [active, doneToday, s] = await Promise.all([
    prisma.devBoardItem.findMany({ where: { status: { not: 'DONE' } }, orderBy: { id: 'asc' } }),
    prisma.devBoardItem.count({ where: { status: 'DONE', updatedAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    settings(),
  ])
  const html = (icons: Icons) => summaryHtml(active, doneToday, chat, icons)
  if (s.summaryId && !toBottom) {
    const edited = await richCall('editMessageText', { chat_id: chat, message_id: s.summaryId }, html)
    if (edited.ok || /not modified/i.test(edited.description ?? '')) return
  }
  if (s.summaryId) await tg('deleteMessage', { chat_id: chat, message_id: s.summaryId })
  const sent = await richCall<{ message_id: number }>('sendRichMessage', { chat_id: chat }, html)
  if (!sent.ok || !sent.result) return
  await saveSettings({ summaryId: sent.result.message_id })
  await tg('pinChatMessage', { chat_id: chat, message_id: sent.result.message_id, disable_notification: true })
}

const snippet = (text: string, max = 400) => (text.length > max ? `${text.slice(0, max)}…` : text)

const safe = (work: () => Promise<unknown>) => { if (devBoardConfigured()) void work().catch(err => logger.warn({ err }, '[DevBoard] пропущено')) }

export const DevBoard = {
  // ── Хуки из поддержки ─────────────────────────────────────
  ticketCreated(ticket: { number: number; nickname: string; subject: string; text: string; hasImage: boolean; image?: { mime: string; data: string } | null }) {
    safe(async () => {
      const item = await prisma.devBoardItem.upsert({
        where: { ticketNumber: ticket.number },
        update: {},
        create: { ticketNumber: ticket.number, title: `${ticket.nickname} · ${ticket.subject}`, note: snippet(ticket.text) },
      })
      await render(item)
      if (ticket.image) await sendShot((await prisma.devBoardItem.findUnique({ where: { id: item.id } })) ?? item, ticket.image, `Скриншот к №${ticket.number}`)
    })
  },

  ticketMessage(ticket: { number: number; nickname: string; subject: string; text: string; reopened: boolean; image?: { mime: string; data: string } | null }) {
    safe(async () => {
      let item = await prisma.devBoardItem.upsert({
        where: { ticketNumber: ticket.number },
        update: {},
        create: { ticketNumber: ticket.number, title: `${ticket.nickname} · ${ticket.subject}`, note: snippet(ticket.text) },
      })
      if (item.status === 'DONE') item = await prisma.devBoardItem.update({ where: { id: item.id }, data: { status: 'OPEN', takenBy: null, doneBy: null } })
      await render(item)
      const fresh = await prisma.devBoardItem.findUnique({ where: { id: item.id } })
      const topic = (await settings()).ticketsTopic
      await tg('sendMessage', {
        chat_id: env.DEV_BOARD_CHAT_ID, parse_mode: 'HTML',
        text: `${ticket.reopened ? 'Игрок открыл снова' : 'Игрок дописал в'} №${ticket.number}:\n${escape(snippet(ticket.text))}`,
        ...(topic ? { message_thread_id: topic } : {}),
        ...(fresh?.messageId ? { reply_parameters: { message_id: fresh.messageId, allow_sending_without_reply: true } } : {}),
      })
      if (ticket.image && fresh) await sendShot(fresh, ticket.image, `Скриншот к №${ticket.number}`)
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
    let active = await prisma.devBoardItem.findMany({ where: { status: { not: 'DONE' } }, orderBy: { id: 'asc' } })
    // Пришло до запуска доски — карточки в группе ещё нет: досылаем один раз.
    const unsent = active.filter(item => !item.messageId)
    if (unsent.length && devBoardConfigured()) {
      for (const item of unsent) await render(item)
      active = await prisma.devBoardItem.findMany({ where: { status: { not: 'DONE' } }, orderBy: { id: 'asc' } })
    }
    const recent = await prisma.devBoardItem.findMany({ where: { status: 'DONE' }, orderBy: { updatedAt: 'desc' }, take: 15 })
    return { active, recentDone: recent }
  },

  /** /board: сводка заново внизу общей темы и закреплена. */
  async summaryToBottom() { await refreshSummary(true) },

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
