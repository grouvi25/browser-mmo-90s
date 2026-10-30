import { prisma } from '../../shared/db/prisma'
import type { User } from '@prisma/client'

export const AuthRepository = {
  async findByLogin(login: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { login } })
  },

  /**
   * Кандидаты на вход (правка 29.10: «везде по нику»). Поле входа принимает
   * ник персонажа, а у старых аккаунтов — и прежний логин или почту. Порядок:
   * точный ник, точный логин, почта, затем без учёта регистра. Пароль
   * проверяется у каждого по очереди, поэтому совпадение чужого логина
   * с чьим-то ником не закрывает вход ни одному из них.
   */
  async findForSignIn(identifier: string): Promise<User[]> {
    const needle = identifier.trim()
    if (!needle) return []
    const rows = await prisma.user.findMany({
      where: {
        OR: [
          { login: { equals: needle, mode: 'insensitive' } },
          { character: { nickname: { equals: needle, mode: 'insensitive' } } },
          ...(needle.includes('@') ? [{ email: { equals: needle, mode: 'insensitive' as const } }] : []),
        ],
      },
      include: { character: { select: { nickname: true } } },
      take: 10,
    })
    const rank = (u: (typeof rows)[number]) =>
      u.character?.nickname === needle ? 0
        : u.login === needle ? 1
          : u.email.toLowerCase() === needle.toLowerCase() ? 2
            : 3
    return rows.sort((a, b) => rank(a) - rank(b)).map(({ character: _c, ...user }) => { void _c; return user })
  },

  /** Ник занят — чужим персонажем или чужим логином (без учёта регистра). */
  async nicknameTaken(nickname: string, exceptUserId?: string): Promise<boolean> {
    const hit = await prisma.user.findFirst({
      where: {
        ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
        OR: [
          { login: { equals: nickname, mode: 'insensitive' } },
          { character: { nickname: { equals: nickname, mode: 'insensitive' } } },
        ],
      },
      select: { id: true },
    })
    return !!hit
  },

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } })
  },

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } })
  },

  async create(data: {
    login: string
    email: string
    emailNormalized?: string
    passwordHash: string
    lastIp?: string
    lastUserAgent?: string
    policyAcceptedAt?: Date
  }): Promise<User> {
    return prisma.user.create({ data })
  },

  async updateLastLogin(id: string, ip?: string, userAgent?: string): Promise<void> {
    await prisma.user.update({
      where: { id },
      data: {
        lastLoginAt: new Date(),
        lastIp: ip,
        lastUserAgent: userAgent,
      },
    })
  },
}
