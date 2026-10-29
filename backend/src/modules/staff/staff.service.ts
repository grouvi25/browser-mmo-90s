// =============================================================
// Сотрудники и вход в админку (правка 30.10).
//
// Было: одна общая учётка «admin» с паролем — кто подобрал, получил всё.
// Стало: сотрудник — обычный игровой аккаунт с ролью. Вход — ник и пароль
// аккаунта, вторым шагом код из письма на его почту. Устройство можно
// запомнить на 30 дней. Неверные пароли запирают вход, роль снимается
// одной кнопкой и сразу закрывает сессии. Всё пишется в журнал сотрудников.
// =============================================================
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { StaffRole } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { verifyPassword } from '../../shared/security/password'
import { revokeAllAdminSessions } from '../../shared/security/jwt'
import { STAFF_ROLES } from '../../shared/security/permissions'
import { sendMail } from '../../shared/mail/mailer'
import { codeEmail } from '../../shared/mail/templates'
import { logger } from '../../shared/logger/logger'
import { AuthRepository } from '../auth/auth.repository'
import { RegistrationGuard } from '../auth/registration-guard'

export const STAFF = {
  codeMinutes: 10,
  codeAttempts: 5,
  /** Новый код — не чаще раза в минуту: письма не заливают ящик. */
  resendSeconds: 60,
  sessionHours: 8,
  deviceDays: 30,
} as const

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

/** Почта для подсказки «код ушёл на ad***@gmail.com». */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  return `${local.slice(0, 2)}***@${domain}`
}

const invalid = () => new AppError(ErrorCode.INVALID_CREDENTIALS, 'Неверный ник или пароль', 401)

async function log(entry: { userId?: string | null; label: string; action: string; details?: Record<string, unknown>; ip?: string }) {
  await prisma.staffEvent.create({
    data: { userId: entry.userId ?? null, label: entry.label.slice(0, 64), action: entry.action, details: entry.details as object | undefined, ip: entry.ip ?? null },
  }).catch(err => logger.warn({ err }, '[Staff] event skipped'))
}

type SessionGrant = { kind: 'session'; staffId: string; role: StaffRole; label: string; deviceToken?: string }
type CodeChallenge = { kind: 'code'; challengeId: string; email: string }

async function staffAccount(userId: string) {
  return prisma.staffMember.findUnique({
    where: { userId },
    select: { id: true, role: true, isActive: true, user: { select: { login: true, email: true, status: true, character: { select: { nickname: true } } } } },
  })
}

async function grant(staffId: string, userId: string, role: StaffRole, label: string, via: 'code' | 'device', ip?: string, deviceToken?: string): Promise<SessionGrant> {
  await prisma.staffMember.update({ where: { id: staffId }, data: { lastLoginAt: new Date() } })
  await log({ userId, label, action: 'login', details: { via: via === 'device' ? 'device' : deviceToken ? 'code+remember' : 'code' }, ip })
  return { kind: 'session', staffId, role, label, ...(deviceToken ? { deviceToken } : {}) }
}

export const StaffService = {
  /**
   * Шаг 1: ник и пароль. Запомненное устройство — сразу сессия, иначе код
   * на почту. Ответ «неверный ник или пароль» одинаков для чужих, не
   * сотрудников и опечаток: по нему не узнать, кто в штате.
   */
  async startLogin(input: { nickname: string; password: string; deviceToken?: string; ip?: string; userAgent?: string }): Promise<SessionGrant | CodeChallenge> {
    const lockKey = `staff:${input.nickname.trim().toLowerCase()}`
    await RegistrationGuard.assertLoginNotLocked(lockKey)
    let found: { userId: string; staff: NonNullable<Awaited<ReturnType<typeof staffAccount>>> } | null = null
    for (const user of await AuthRepository.findForSignIn(input.nickname)) {
      if (!(await verifyPassword(input.password, user.passwordHash))) continue
      const staff = await staffAccount(user.id)
      if (staff?.isActive && staff.user.status !== 'BANNED') { found = { userId: user.id, staff }; break }
    }
    if (!found) {
      await RegistrationGuard.recordLoginFailure(lockKey)
      await log({ label: input.nickname, action: 'login_failed', ip: input.ip })
      throw invalid()
    }
    await RegistrationGuard.clearLoginFailures(lockKey)
    const { userId, staff } = found
    const label = staff.user.character?.nickname ?? staff.user.login

    if (input.deviceToken) {
      const device = await prisma.staffTrustedDevice.findUnique({ where: { tokenHash: hash(input.deviceToken) } })
      if (device && device.userId === userId && device.expiresAt > new Date()) {
        await prisma.staffTrustedDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } })
        return grant(staff.id, userId, staff.role, label, 'device', input.ip)
      }
    }

    // Код уже ушёл меньше минуты назад — отвечаем тем же, письмо не шлём.
    const recent = await prisma.staffLoginCode.findFirst({
      where: { userId, usedAt: null, createdAt: { gt: new Date(Date.now() - STAFF.resendSeconds * 1000) } },
      orderBy: { createdAt: 'desc' },
    })
    if (recent) return { kind: 'code', challengeId: recent.id, email: maskEmail(staff.user.email) }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const row = await prisma.staffLoginCode.create({
      data: { userId, codeHash: hash(code), expiresAt: new Date(Date.now() + STAFF.codeMinutes * 60_000), ip: input.ip ?? null },
    })
    const mail = codeEmail({ who: label, purpose: 'вход в панель управления', code, minutes: STAFF.codeMinutes })
    const sent = await sendMail({ to: staff.user.email, ...mail })
    if (!sent.ok) {
      await prisma.staffLoginCode.delete({ where: { id: row.id } })
      await log({ userId, label, action: 'code_failed', details: { error: sent.error?.slice(0, 200) }, ip: input.ip })
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, 'Письмо с кодом не ушло. Попробуйте через пару минут', 503)
    }
    await log({ userId, label, action: 'code_sent', ip: input.ip })
    return { kind: 'code', challengeId: row.id, email: maskEmail(staff.user.email) }
  },

  /** Шаг 2: код из письма. «Запомнить» выдаёт ключ устройства на 30 дней. */
  async verifyCode(input: { challengeId: string; code: string; remember?: boolean; ip?: string; userAgent?: string }): Promise<SessionGrant> {
    const row = await prisma.staffLoginCode.findUnique({ where: { id: input.challengeId } })
    const expired = new AppError(ErrorCode.VALIDATION_ERROR, 'Код устарел — войдите заново, придёт новый', 410)
    if (!row || row.usedAt || row.expiresAt < new Date()) throw expired
    if (row.attempts >= STAFF.codeAttempts) throw new AppError(ErrorCode.AUTH_TOO_MANY, 'Слишком много неверных кодов — войдите заново', 429)

    const given = Buffer.from(hash(input.code.trim()))
    const ok = given.length === row.codeHash.length && timingSafeEqual(given, Buffer.from(row.codeHash))
    const staff = await staffAccount(row.userId)
    const label = staff?.user.character?.nickname ?? staff?.user.login ?? '—'
    if (!ok) {
      const attempts = row.attempts + 1
      await prisma.staffLoginCode.update({ where: { id: row.id }, data: { attempts } })
      await log({ userId: row.userId, label, action: 'code_wrong', details: { attempts }, ip: input.ip })
      const left = STAFF.codeAttempts - attempts
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, left > 0 ? `Неверный код. Осталось попыток: ${left}` : 'Неверный код. Попытки кончились — войдите заново', 401)
    }
    // Пока вводили код, роль могли снять.
    if (!staff?.isActive || staff.user.status === 'BANNED') throw invalid()
    await prisma.staffLoginCode.update({ where: { id: row.id }, data: { usedAt: new Date() } })

    let deviceToken: string | undefined
    if (input.remember) {
      deviceToken = randomBytes(32).toString('base64url')
      await prisma.staffTrustedDevice.create({
        data: { userId: row.userId, tokenHash: hash(deviceToken), userAgent: input.userAgent?.slice(0, 300) ?? null, expiresAt: new Date(Date.now() + STAFF.deviceDays * 86_400_000) },
      })
    }
    return grant(staff.id, row.userId, staff.role, label, 'code', input.ip, deviceToken)
  },

  /** Выйти везде: все сессии и запомненные устройства сотрудника. */
  async logoutEverywhere(staffId: string, label: string, ip?: string) {
    const staff = await prisma.staffMember.findUniqueOrThrow({ where: { id: staffId }, select: { userId: true } })
    const sessions = await revokeAllAdminSessions(staffId)
    const devices = await prisma.staffTrustedDevice.deleteMany({ where: { userId: staff.userId } })
    await log({ userId: staff.userId, label, action: 'logout_all', details: { sessions, devices: devices.count }, ip })
    return { sessions, devices: devices.count }
  },

  // ── Управление сотрудниками ────────────────────────────────

  async list() {
    const rows = await prisma.staffMember.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true, role: true, isActive: true, createdBy: true, createdAt: true, lastLoginAt: true,
        user: { select: { login: true, email: true, character: { select: { nickname: true, battleLevel: true } } } },
      },
    })
    return {
      items: rows.map(({ user, ...row }) => ({
        ...row, roleTitle: STAFF_ROLES[row.role].title,
        nickname: user.character?.nickname ?? user.login, login: user.login, email: maskEmail(user.email), level: user.character?.battleLevel ?? null,
      })),
      roles: Object.entries(STAFF_ROLES).map(([role, info]) => ({ role, title: info.title, permissions: info.permissions })),
    }
  },

  /** Назначить по нику игрока; уже сотрудник — меняется роль и включается. */
  async add(input: { nickname: string; role: StaffRole }, by: { label: string; ip?: string }) {
    const needle = input.nickname.trim()
    const user = await prisma.user.findFirst({
      where: { OR: [{ character: { nickname: { equals: needle, mode: 'insensitive' } } }, { login: { equals: needle, mode: 'insensitive' } }] },
      select: { id: true, login: true, character: { select: { nickname: true } } },
    })
    if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'Игрок с таким ником не найден', 404)
    const row = await prisma.staffMember.upsert({
      where: { userId: user.id },
      create: { userId: user.id, role: input.role, createdBy: by.label },
      update: { role: input.role, isActive: true },
    })
    await log({ userId: user.id, label: by.label, action: 'staff_added', details: { nickname: user.character?.nickname ?? user.login, role: input.role }, ip: by.ip })
    return row
  },

  async update(staffId: string, patch: { role?: StaffRole; isActive?: boolean }, by: { staffId: string | null; label: string; ip?: string }) {
    const row = await prisma.staffMember.findUnique({ where: { id: staffId }, select: { id: true, userId: true, role: true, isActive: true, user: { select: { login: true, character: { select: { nickname: true } } } } } })
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Сотрудник не найден', 404)
    const losesOwner = row.role === 'OWNER' && row.isActive && ((patch.role && patch.role !== 'OWNER') || patch.isActive === false)
    if (losesOwner) {
      const owners = await prisma.staffMember.count({ where: { role: 'OWNER', isActive: true } })
      if (owners <= 1) throw new AppError(ErrorCode.CONFLICT, 'Нельзя снять последнего владельца', 409)
    }
    const updated = await prisma.staffMember.update({ where: { id: staffId }, data: { ...(patch.role ? { role: patch.role } : {}), ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}) } })
    // Права поменялись — старые сессии закрываем: войдёт заново с новыми.
    if ((patch.role && patch.role !== row.role) || patch.isActive === false) {
      await revokeAllAdminSessions(staffId)
      if (patch.isActive === false) await prisma.staffTrustedDevice.deleteMany({ where: { userId: row.userId } })
    }
    await log({
      userId: row.userId, label: by.label,
      action: patch.isActive === false ? 'staff_disabled' : patch.isActive === true && !row.isActive ? 'staff_enabled' : 'staff_role',
      details: { nickname: row.user.character?.nickname ?? row.user.login, from: row.role, to: patch.role ?? row.role }, ip: by.ip,
    })
    return updated
  },

  async events(limit = 100) {
    return {
      items: await prisma.staffEvent.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(limit, 300), select: { id: true, label: true, action: true, details: true, ip: true, createdAt: true } }),
    }
  },
}
