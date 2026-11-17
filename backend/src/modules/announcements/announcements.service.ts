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
      where: { removedAt: null, isDraft: false, ...(kind ? { kind } : {}) },
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
    /** Подпись под объявлением: ник сотрудника или логин старой учётки. */
    authorLabel?: string
  }) {
    const title = trimTo(input.title, MAX_TITLE)
    const body = trimTo(input.body, MAX_BODY)
    if (!title || !body) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Заголовок и текст обязательны', 422)
    }
    const admin = input.authorLabel ? { username: input.authorLabel } : await prisma.adminUser.findUnique({
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

  /** Черновики для админки: свежие сверху. */
  async drafts() {
    return prisma.announcement.findMany({
      where: { removedAt: null, isDraft: true },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, kind: true, title: true, body: true, pinned: true, authorLogin: true, createdAt: true, updatedAt: true },
    })
  },

  /** Сохранить черновик: новый или поверх старого. В ленту не попадает. */
  async saveDraft(input: { id?: string; kind: AnnouncementKind; title: string; body: string; pinned?: boolean; authorLabel?: string }) {
    const title = trimTo(input.title, MAX_TITLE)
    const body = trimTo(input.body, MAX_BODY)
    if (!title || !body) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Заголовок и текст обязательны', 422)
    const data = { kind: input.kind, title, body, pinned: input.pinned ?? false }
    const select = { id: true, kind: true, title: true, body: true, pinned: true, authorLogin: true, createdAt: true, updatedAt: true }
    if (input.id) {
      const { count } = await prisma.announcement.updateMany({ where: { id: input.id, isDraft: true, removedAt: null }, data })
      if (!count) throw new AppError(ErrorCode.NOT_FOUND, 'Черновик не найден', 404)
      return prisma.announcement.findUniqueOrThrow({ where: { id: input.id }, select })
    }
    return prisma.announcement.create({ data: { ...data, isDraft: true, authorLogin: input.authorLabel ?? null }, select })
  },

  /** Опубликовать черновик: уходит в ленту со временем публикации и подписью публикующего. */
  async publishDraft(id: string, authorLabel: string) {
    const { count } = await prisma.announcement.updateMany({
      where: { id, isDraft: true, removedAt: null },
      data: { isDraft: false, createdAt: new Date(), authorLogin: authorLabel },
    })
    if (!count) throw new AppError(ErrorCode.NOT_FOUND, 'Черновик не найден', 404)
    return prisma.announcement.findUniqueOrThrow({
      where: { id },
      select: { id: true, kind: true, title: true, body: true, pinned: true, authorLogin: true, createdAt: true },
    })
  },

  /** Закрепить или открепить: закреплённое висит сверху ленты. */
  async pin(id: string, pinned: boolean) {
    const { count } = await prisma.announcement.updateMany({
      where: { id, removedAt: null },
      data: { pinned },
    })
    if (!count) throw new AppError(ErrorCode.NOT_FOUND, 'Announcement not found', 404)
    return { id, pinned }
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
