import { PrismaClient } from '@prisma/client'
import { env } from '../../config/env'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
    errorFormat: 'minimal',
  })

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export async function connectDb(): Promise<void> {
  await prisma.$connect()
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect()
}
