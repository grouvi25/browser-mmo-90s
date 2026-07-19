import { prisma } from '../../shared/db/prisma'
import type { User } from '@prisma/client'

export const AuthRepository = {
  async findByLogin(login: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { login } })
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
    passwordHash: string
    lastIp?: string
    lastUserAgent?: string
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
