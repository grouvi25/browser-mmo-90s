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
import { FLOOD, MAX_BODY, floodKeys, normalizeBody, scopeFor, type Rejection } from './chat.formulas'

/** Сколько держим игрока в списке онлайна после последнего касания. */
const PRESENCE_TTL_SEC = 120
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
}

interface Speaker {
  characterId: string
  userId: string
  clanId: string | null
  mutedUntil: Date | null
}

function toLine(row: {
  id: string; channel: ChatChannel; scope: string; authorId: string; body: string; createdAt: Date
  author: { nickname: string; battleLevel: number }
}): ChatLine {
  return {
    id: row.id, channel: row.channel, scope: row.scope, authorId: row.authorId,
    nickname: row.author.nickname, level: row.author.battleLevel,
    body: row.body, createdAt: row.createdAt,
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
    if (!character) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)

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
      const message = channel === 'CLAN' ? 'You are not in a clan' : 'Unknown chat room'
      throw new AppError(ErrorCode.FORBIDDEN, message, 403)
    }
    return scope
  },

  /** Последние реплики канала, старые сверху — как их читают в ленте. */
  async history(channel: ChatChannel, scope: string, limit = HISTORY_LIMIT): Promise<ChatLine[]> {
    const rows = await prisma.chatMessage.findMany({
      where: { channel, scope, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), HISTORY_LIMIT),
      select: {
        id: true, channel: true, scope: true, authorId: true, body: true, createdAt: true,
        author: { select: { nickname: true, battleLevel: true } },
      },
    })
    return rows.reverse().map(toLine)
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
  ): Promise<{ ok: true; line: ChatLine } | { ok: false; reason: Rejection }> {
    if (who.mutedUntil && who.mutedUntil > now) {
      throw new AppError(ErrorCode.FORBIDDEN, 'You are muted', 403)
    }

    const scope = this.roomFor(channel, rawScope, who)

    const body = normalizeBody(rawBody)
    if (!body) return { ok: false, reason: { kind: 'empty' } }
    if (body.length > MAX_BODY) return { ok: false, reason: { kind: 'too-long', max: MAX_BODY } }

    const flood = await this.floodCheck(who.characterId, body, now.getTime())
    if (flood) return { ok: false, reason: flood }

    const row = await prisma.chatMessage.create({
      data: { channel, scope, authorId: who.characterId, body },
      select: {
        id: true, channel: true, scope: true, authorId: true, body: true, createdAt: true,
        author: { select: { nickname: true, battleLevel: true } },
      },
    })
    return { ok: true, line: toLine(row) }
  },

  /** Кто сейчас в эфире. Имена подтягиваем одним запросом по списку. */
  async online(limit = ONLINE_LIMIT) {
    const ids = await ChatRedis.presenceList(PRESENCE_TTL_SEC, limit)
    if (!ids.length) return []
    const rows = await prisma.character.findMany({
      where: { id: { in: ids } },
      select: { id: true, nickname: true, battleLevel: true },
    })
    // Порядок задаёт Redis — свежие первыми; база отдаёт как попало.
    const byId = new Map(rows.map(r => [r.id, r]))
    return ids.flatMap(id => {
      const row = byId.get(id)
      return row ? [{ characterId: row.id, nickname: row.nickname, level: row.battleLevel }] : []
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
