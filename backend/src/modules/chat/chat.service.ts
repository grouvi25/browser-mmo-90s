// =============================================================
// Эфир: чтение ленты и приём реплик.
//
// Право на канал проверяется здесь, а не в маршруте, потому что
// правило одно и то же и для HTTP, и для сокета: район — открыт всем,
// клан — только своим, общий — открыт всем. Комнату клана клиент не
// называет: её берут из членства, поэтому в чужой клан не написать
// даже подделав запрос.
// =============================================================
import type { ChatChannel } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { ChatRedis } from '../../shared/db/redis'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { FLOOD, MAX_BODY, chatDayStart, floodKeys, normalizeBody, scopeFor, type Rejection } from './chat.formulas'

/**
 * Сколько ник держится в списке онлайн после последнего действия игрока.
 * Правка заказчика 22.10: «чтобы через минуту не пропадали ники, пока
 * можно час поставить» — было две минуты, и закрытая вкладка снимала ник сразу.
 */
export const PRESENCE_TTL_SEC = 3600
const ONLINE_LIMIT = 100
const HISTORY_LIMIT = 50

export interface ChatLine {
  id: string
  channel: ChatChannel
  scope: string
  authorId: string
  nickname: string
  level: number
  body: string
  createdAt: Date
  /** Только у личных сообщений: кому написано. */
  recipientId?: string | null
  recipientNickname?: string | null
}

const LINE_SELECT = {
  id: true, channel: true, scope: true, authorId: true, recipientId: true, body: true, createdAt: true,
  author: { select: { nickname: true, battleLevel: true } },
} as const

interface Speaker {
  characterId: string
  userId: string
  clanId: string | null
  mutedUntil: Date | null
}

function toLine(row: {
  id: string; channel: ChatChannel; scope: string; authorId: string; recipientId: string | null; body: string; createdAt: Date
  author: { nickname: string; battleLevel: number }
}, recipientNickname: string | null = null): ChatLine {
  return {
    id: row.id, channel: row.channel, scope: row.scope, authorId: row.authorId,
    nickname: row.author.nickname, level: row.author.battleLevel,
    body: row.body, createdAt: row.createdAt,
    ...(row.channel === 'PRIVATE' ? { recipientId: row.recipientId, recipientNickname } : {}),
  }
}

export const ChatService = {
  /**
   * Кто говорит и что ему можно. Один запрос на всё: членство в клане
   * и запрет на речь читаются вместе с персонажем.
   */
  async speaker(userId: string): Promise<Speaker> {
    const character = await prisma.character.findUnique({
      where: { userId },
      select: {
        id: true,
        user: { select: { mutedUntil: true } },
      },
    })
    if (!character) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)

    const membership = await prisma.clanMember.findUnique({
      where: { characterId: character.id },
      select: { clanId: true, status: true },
    })

    return {
      characterId: character.id,
      userId,
      // Бывший состав клана канала не получает: членство обязано быть
      // действующим, иначе исключённый продолжал бы читать чужой эфир.
      clanId: membership?.status === 'ACTIVE' ? membership.clanId : null,
      mutedUntil: character.user.mutedUntil,
    }
  },

  /** Адрес комнаты с проверкой права. Бросает, если канал не открыт. */
  roomFor(channel: ChatChannel, rawScope: string | undefined, who: Speaker): string {
    const scope = scopeFor(channel, rawScope, who.clanId)
    if (scope === null) {
      const message = channel === 'CLAN' ? 'Вы не состоите в бригаде' : 'Такой комнаты нет'
      throw new AppError(ErrorCode.FORBIDDEN, message, 403)
    }
    return scope
  },

  /** Последние реплики канала, старые сверху — как их читают в ленте. */
  async history(channel: ChatChannel, scope: string, limit = HISTORY_LIMIT, now = new Date()): Promise<ChatLine[]> {
    const rows = await prisma.chatMessage.findMany({
      where: { channel, scope, deletedAt: null, createdAt: { gte: chatDayStart(now) } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), HISTORY_LIMIT),
      select: LINE_SELECT,
    })
    return rows.reverse().map(row => toLine(row))
  },

  /** Переписка игрока: всё, что он написал лично и что написали ему. */
  async privateHistory(characterId: string, limit = HISTORY_LIMIT, now = new Date()): Promise<ChatLine[]> {
    const rows = await prisma.chatMessage.findMany({
      where: { channel: 'PRIVATE', deletedAt: null, createdAt: { gte: chatDayStart(now) }, OR: [{ authorId: characterId }, { recipientId: characterId }] },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), HISTORY_LIMIT),
      select: LINE_SELECT,
    })
    const ids = [...new Set(rows.map(r => r.recipientId).filter(Boolean) as string[])]
    const names = new Map((await prisma.character.findMany({ where: { id: { in: ids } }, select: { id: true, nickname: true } }))
      .map(c => [c.id, c.nickname]))
    return rows.reverse().map(row => toLine(row, row.recipientId ? names.get(row.recipientId) ?? null : null))
  },

  /**
   * Антифлуд. Возвращает причину отказа или null. Порядок проверок —
   * от самой дешёвой к самой дорогой, и от самой частой к редкой.
   */
  async floodCheck(characterId: string, body: string, now = Date.now()): Promise<Rejection | null> {
    const last = await ChatRedis.lastSpokeAt(floodKeys.last(characterId))
    if (last !== null && now - last < FLOOD.minGapMs) {
      return { kind: 'too-fast', waitMs: FLOOD.minGapMs - (now - last) }
    }

    const count = await ChatRedis.countInWindow(floodKeys.window(characterId), FLOOD.windowSec)
    if (count > FLOOD.windowLimit) {
      return { kind: 'too-many', limit: FLOOD.windowLimit, windowSec: FLOOD.windowSec }
    }

    const fingerprint = body.toLowerCase()
    const previous = await ChatRedis.lastFingerprint(floodKeys.repeat(characterId))
    if (previous !== null && previous === fingerprint) return { kind: 'repeat' }

    await ChatRedis.markSpokeAt(floodKeys.last(characterId), now, FLOOD.windowSec)
    await ChatRedis.markFingerprint(floodKeys.repeat(characterId), fingerprint, FLOOD.repeatSec)
    return null
  },

  /**
   * Принять реплику. Отказ возвращается значением, а не исключением:
   * «слишком часто» — обычный ход разговора, а не сбой, и клиенту
   * нужно показать подсказку, а не красную ошибку.
   */
  async send(
    who: Speaker,
    channel: ChatChannel,
    rawScope: string | undefined,
    rawBody: string,
    now = new Date(),
    recipientNick?: string,
  ): Promise<{ ok: true; line: ChatLine } | { ok: false; reason: Rejection }> {
    if (who.mutedUntil && who.mutedUntil > now) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Вам запрещено писать в чат до ' + who.mutedUntil.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }), 403)
    }

    const scope = this.roomFor(channel, rawScope, who)
    // Личное сообщение: получатель по нику, без учёта регистра.
    let recipient: { id: string; nickname: string } | null = null
    if (channel === 'PRIVATE') {
      const to = (recipientNick ?? '').trim()
      recipient = to ? await prisma.character.findFirst({
        where: { nickname: { equals: to, mode: 'insensitive' } }, select: { id: true, nickname: true },
      }) : null
      if (!recipient) throw new AppError(ErrorCode.NOT_FOUND, to ? `Игрок «${to}» не найден` : 'Кому написать? Нажмите на ник в чате', 404)
      if (recipient.id === who.characterId) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Себе писать не нужно', 422)
    }

    const body = normalizeBody(rawBody)
    if (!body) return { ok: false, reason: { kind: 'empty' } }
    if (body.length > MAX_BODY) return { ok: false, reason: { kind: 'too-long', max: MAX_BODY } }

    const flood = await this.floodCheck(who.characterId, body, now.getTime())
    if (flood) return { ok: false, reason: flood }

    const row = await prisma.chatMessage.create({
      data: { channel, scope, authorId: who.characterId, recipientId: recipient?.id ?? null, body },
      select: LINE_SELECT,
    })
    return { ok: true, line: toLine(row, recipient?.nickname ?? null) }
  },

  /** Кто сейчас в эфире. Имена подтягиваем одним запросом по списку. */
  async online(limit = ONLINE_LIMIT) {
    const ids = await ChatRedis.presenceList(PRESENCE_TTL_SEC, limit)
    if (!ids.length) return []
    const rows = await prisma.character.findMany({
      where: { id: { in: ids } },
      select: { id: true, nickname: true, battleLevel: true, clanId: true },
    })
    const clanIds = [...new Set(rows.map(r => r.clanId).filter(Boolean) as string[])]
    const clans = new Map((await prisma.clan.findMany({
      where: { id: { in: clanIds } }, select: { id: true, name: true, iconVersion: true },
    })).map(c => [c.id, c]))
    // Порядок задаёт Redis — свежие первыми; база отдаёт как попало.
    const byId = new Map(rows.map(r => [r.id, r]))
    return ids.flatMap(id => {
      const row = byId.get(id)
      // Бригада с иконкой — в списке онлайн рядом с ником (правка 21.10).
      return row ? [{ characterId: row.id, nickname: row.nickname, level: row.battleLevel, clan: row.clanId ? clans.get(row.clanId) ?? null : null }] : []
    })
  },

  async touch(characterId: string): Promise<void> {
    await ChatRedis.presenceTouch(characterId)
  },

  async leave(characterId: string): Promise<void> {
    await ChatRedis.presenceLeave(characterId)
  },

  /** Модерация: спрятать реплику, оставив след для разбора жалобы. */
  async hide(messageId: string, byUserId: string): Promise<void> {
    await prisma.chatMessage.updateMany({
      where: { id: messageId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: byUserId },
    })
  },
}
