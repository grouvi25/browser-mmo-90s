// =============================================================
// Восстановление пароля (просьба игроков 26–27.10: «нет возможности
// восстановить пароль, если его забыл, при входе с нового устройства»).
//
// Игрок называет логин или почту — получает одноразовую ссылку на новый
// пароль, живущую час. Ответ всегда один и тот же: по нему нельзя узнать,
// есть ли такой игрок и какая у него почта.
//
// Куда уходит ссылка. Почтового ящика у игры пока нет: домен на почте
// Beget, письма прямо с сервера ушли бы в спам. Поэтому ссылку получает
// администрация в бот оповещений и пересылает игроку, убедившись, что
// просит владелец. Когда появится ящик (SMTP), здесь добавится письмо
// игроку — остальное менять не придётся.
// =============================================================
import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '../../shared/db/prisma'
import { hashPassword } from '../../shared/security/password'
import { SessionRedis } from '../../shared/db/redis'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { audit } from '../../shared/logger/audit-logger'
import { logger } from '../../shared/logger/logger'
import { env } from '../../config/env'
import { sendTelegram, telegramConfigured } from '../admin-balance/telegram.service'

/** Ссылка живёт час: дольше — лишний риск, короче — не успеют переслать. */
export const RESET_TTL_MS = 60 * 60_000
/** Не чаще раза в пять минут на аккаунт: иначе бот завалят заявками. */
export const RESET_COOLDOWN_MS = 5 * 60_000

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const escapeHtml = (value: string) => value.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]!))

export const PasswordResetService = {
  async request(loginOrEmail: string, ip?: string): Promise<{ ok: true }> {
    const needle = loginOrEmail.trim()
    const user = await prisma.user.findFirst({
      where: { OR: [{ login: needle }, { email: { equals: needle, mode: 'insensitive' } }] },
      select: { id: true, login: true, email: true, status: true },
    })
    if (!user || user.status === 'BANNED') {
      audit('user.password_reset_unknown', { needle: needle.slice(0, 64), ip })
      return { ok: true }
    }
    const recent = await prisma.passwordReset.findFirst({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESET_COOLDOWN_MS) } },
      select: { id: true },
    })
    if (recent) return { ok: true }

    const token = randomBytes(32).toString('base64url')
    await prisma.passwordReset.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS), ip },
    })
    const link = `${env.APP_URL.replace(/\/$/, '')}/reset-password?token=${token}`
    audit('user.password_reset_requested', { userId: user.id, login: user.login, ip })

    if (!telegramConfigured()) {
      logger.warn({ userId: user.id }, '[Пароль] Заявка на сброс: бот оповещений не настроен, ссылку некому передать')
      return { ok: true }
    }
    const text = [
      '<b>Сброс пароля</b>',
      `Игрок <b>${escapeHtml(user.login)}</b>, почта ${escapeHtml(user.email)}, просит новый пароль.`,
      'Перешлите ссылку ему лично, только убедившись, что просит владелец. Ссылка действует час и срабатывает один раз:',
      escapeHtml(link),
    ].join('\n')
    const sent = await sendTelegram(text)
    if (!sent.ok) logger.error({ userId: user.id, error: sent.error }, '[Пароль] Ссылка на сброс не ушла в бот')
    return { ok: true }
  },

  async reset(token: string, newPassword: string): Promise<{ login: string }> {
    const row = await prisma.passwordReset.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { id: true, login: true, status: true } } },
    })
    if (!row || row.usedAt || row.expiresAt <= new Date() || row.user.status === 'BANNED') {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Ссылка устарела или уже использована — запросите новую', 400)
    }
    const passwordHash = await hashPassword(newPassword)
    await prisma.$transaction(async tx => {
      const claimed = await tx.passwordReset.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })
      if (claimed.count !== 1) throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Ссылка уже использована — запросите новую', 400)
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash } })
      // Прочие ссылки того же игрока гасим: пароль уже новый.
      await tx.passwordReset.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } })
    })
    // Кто сидел в аккаунте со старым паролем — выходит.
    await SessionRedis.revokeAllForUser(row.userId)
    audit('user.password_reset_done', { userId: row.userId, login: row.user.login })
    return { login: row.user.login }
  },
}
