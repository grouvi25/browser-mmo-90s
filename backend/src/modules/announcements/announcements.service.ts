// =============================================================
// Городские объявления.
//
// Лента одна, источника три. События мира пишет сама игра — для этого
// есть world(): её зовут другие модули, когда случилось то, о чём
// стоит объявить городу. Объявление никогда не ломает вызвавшую
// операцию: захват территории не должен откатываться из-за того, что
// про него не удалось написать.
// =============================================================
import type { AnnouncementKind } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { logger } from '../../shared/logger/logger'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { MAX_BODY, MAX_TITLE, trimTo } from './announcements.formulas'

const FEED_LIMIT = 30

export const AnnouncementsService = {
  /** Живая лента: закреплённое сверху, дальше свежее. */
  async feed(kind?: AnnouncementKind, limit = FEED_LIMIT) {
    return prisma.announcement.findMany({
      where: { removedAt: null, ...(kind ? { kind } : {}) },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(Math.max(limit, 1), FEED_LIMIT),
      select: {
        id: true, kind: true, title: true, body: true,
        pinned: true, authorLogin: true, createdAt: true,
      },
    })
  },

  /** Написать от администрации. Пустое и одни пробелы не проходят. */
  async publish(input: {
    kind: AnnouncementKind
    title: string
    body: string
    pinned?: boolean
    adminId: string
  }) {
    const title = trimTo(input.title, MAX_TITLE)
    const body = trimTo(input.body, MAX_BODY)
    if (!title || !body) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Заголовок и текст обязательны', 422)
    }
    const admin = await prisma.adminUser.findUnique({
      where: { id: input.adminId },
      select: { username: true },
    })
    return prisma.announcement.create({
      data: {
        kind: input.kind, title, body,
        pinned: input.pinned ?? false,
        authorLogin: admin?.username ?? null,
      },
      select: {
        id: true, kind: true, title: true, body: true,
        pinned: true, authorLogin: true, createdAt: true,
      },
    })
  },

  /** Убрать из ленты, оставив в истории. */
  async remove(id: string) {
    const { count } = await prisma.announcement.updateMany({
      where: { id, removedAt: null },
      data: { removedAt: new Date() },
    })
    if (!count) throw new AppError(ErrorCode.NOT_FOUND, 'Announcement not found', 404)
  },

  /**
   * Событие мира. Зовётся из других модулей и НИКОГДА не бросает:
   * объявление — это следствие, а не часть операции, и падение здесь
   * не должно откатывать захват территории или итог войны.
   */
  async world(title: string, body: string): Promise<void> {
    try {
      const safeTitle = trimTo(title, MAX_TITLE)
      const safeBody = trimTo(body, MAX_BODY)
      if (!safeTitle || !safeBody) return
      await prisma.announcement.create({
        data: { kind: 'WORLD', title: safeTitle, body: safeBody },
      })
    } catch (err) {
      logger.warn({ err, title }, 'World announcement skipped')
    }
  },
}
