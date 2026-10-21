// =============================================================
// Поддержка (правка заказчика 21.10.2026): в Центре кнопка «Поддержка» —
// текст и форма обращения со скриншотом. Обращения разбирают в админке,
// ответ приходит игроку уведомлением и виден в его списке обращений.
// =============================================================
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { logger } from '../../shared/logger/logger'
import { NoticesService } from '../chat/notices.service'
import { sendTelegram } from '../admin-balance/telegram.service'

export const SUPPORT = {
  textMax: 2000,
  /** Клиент ужимает скриншот в JPEG до 1600 px. Весь запрос должен уложиться
      в 1 МБ — лимит nginx на сервере по умолчанию. */
  imageMaxBytes: 700_000,
  /** Открытых обращений у одного игрока — не больше, чтобы форму не заливали. */
  openMax: 3,
} as const

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/

const LIST_FIELDS = { id: true, text: true, status: true, reply: true, repliedAt: true, createdAt: true, imageMime: true } as const

function plain<T extends { imageMime: string | null }>(row: T) {
  const { imageMime, ...rest } = row
  return { ...rest, hasImage: !!imageMime }
}

export const SupportService = {
  async create(characterId: string, text: string, dataUrl?: string | null) {
    const body = text.trim()
    if (!body) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Опишите, что случилось', 422)
    let image: { data: string; mime: string } | null = null
    if (dataUrl) {
      const parsed = DATA_URL.exec(dataUrl)
      if (!parsed) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Скриншот: картинка PNG, JPEG или WebP', 422)
      if (Buffer.byteLength(parsed[2], 'base64') > SUPPORT.imageMaxBytes) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Скриншот слишком большой: не больше 700 КБ', 422)
      }
      image = { mime: parsed[1], data: parsed[2] }
    }
    const open = await prisma.supportTicket.count({ where: { characterId, status: 'OPEN' } })
    if (open >= SUPPORT.openMax) {
      throw new AppError(ErrorCode.RATE_LIMITED, 'У вас уже есть открытые обращения — дождитесь ответа на них', 429)
    }
    const ticket = await prisma.supportTicket.create({
      data: { characterId, text: body, imageData: image?.data ?? null, imageMime: image?.mime ?? null },
      select: { ...LIST_FIELDS, character: { select: { nickname: true } } },
    })
    // Уведомление администрации — без ожидания: упавший бот не мешает игроку.
    void sendTelegram(`Обращение в поддержку от ${escapeHtml(ticket.character.nickname)}${image ? ' (со скриншотом)' : ''}:\n${escapeHtml(body.slice(0, 500))}`)
      .catch(err => logger.warn({ err }, '[Support] telegram skipped'))
    const { character: _c, ...row } = ticket
    void _c
    return plain(row)
  },

  async mine(characterId: string) {
    const rows = await prisma.supportTicket.findMany({ where: { characterId }, orderBy: { createdAt: 'desc' }, take: 20, select: LIST_FIELDS })
    return { items: rows.map(plain) }
  },

  async adminList(status?: 'OPEN' | 'ANSWERED' | 'CLOSED') {
    const rows = await prisma.supportTicket.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: status === 'OPEN' ? 'asc' : 'desc' },
      take: 100,
      select: { ...LIST_FIELDS, repliedBy: true, characterId: true, character: { select: { nickname: true, battleLevel: true } } },
    })
    return { items: rows.map(plain) }
  },

  async image(ticketId: string) {
    const row = await prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { imageData: true, imageMime: true } })
    if (!row?.imageData || !row.imageMime) return null
    return { mime: row.imageMime, bytes: Buffer.from(row.imageData, 'base64') }
  },

  async reply(ticketId: string, adminLabel: string, text: string) {
    const body = text.trim()
    if (!body) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Пустой ответ', 422)
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } })
    if (!ticket) throw new AppError(ErrorCode.NOT_FOUND, 'Обращение не найдено', 404)
    const updated = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { reply: body, repliedAt: new Date(), repliedBy: adminLabel, status: 'ANSWERED' },
      select: LIST_FIELDS,
    })
    await NoticesService.push(ticket.characterId, `Ответ поддержки: ${body}`)
    return plain(updated)
  },

  async close(ticketId: string) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { id: true } })
    if (!ticket) throw new AppError(ErrorCode.NOT_FOUND, 'Обращение не найдено', 404)
    return plain(await prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'CLOSED' }, select: LIST_FIELDS }))
  },
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
