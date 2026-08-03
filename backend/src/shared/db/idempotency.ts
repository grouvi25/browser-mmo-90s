import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { withTransaction } from './transaction'
import { AppError } from '../errors/app-error'
import { ErrorCode } from '../errors/error-codes'

export async function withIdempotency<T extends object>(params: {
  characterId: string
  scope: string
  key: string
  ttlHours?: number
  execute: (tx: Prisma.TransactionClient) => Promise<T>
}): Promise<T & { replayed?: boolean }> {
  if (params.key.length < 8 || params.key.length > 128) {
    throw new AppError(ErrorCode.CONFLICT, 'Idempotency-Key must contain 8-128 characters', 400)
  }
  const where = { characterId_scope_key: { characterId: params.characterId, scope: params.scope, key: params.key } }
  const now = new Date()
  const existing = await prisma.idempotencyKey.findUnique({ where })
  if (existing && existing.expiresAt > now) return { ...(existing.responseJson as T), replayed: true }

  try {
    return await withTransaction(async tx => {
      const inside = await tx.idempotencyKey.findUnique({ where })
      if (inside?.expiresAt && inside.expiresAt > new Date()) {
        return { ...(inside.responseJson as T), replayed: true }
      }
      if (inside) await tx.idempotencyKey.delete({ where })
      const response = await params.execute(tx)
      await tx.idempotencyKey.create({
        data: {
          characterId: params.characterId,
          scope: params.scope,
          key: params.key,
          responseJson: response,
          expiresAt: new Date(Date.now() + (params.ttlHours ?? 24) * 3_600_000),
        },
      })
      return response
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const replay = await prisma.idempotencyKey.findUniqueOrThrow({ where })
      return { ...(replay.responseJson as T), replayed: true }
    }
    throw error
  }
}

export async function cleanupExpiredIdempotencyKeys(now = new Date()): Promise<number> {
  const deleted = await prisma.idempotencyKey.deleteMany({
    where: { expiresAt: { lte: now } },
  })
  return deleted.count
}
