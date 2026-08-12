import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { withTransaction } from './transaction'
import { AppError } from '../errors/app-error'
import { ErrorCode } from '../errors/error-codes'
import { BalanceConfig } from '../../config/balance.config'
import { getRedis } from './redis'
import { audit } from '../logger/audit-logger'


async function recordIdempotencyReplay(characterId: string, scope: string): Promise<void> {
  const hour = new Date().toISOString().slice(0, 13)
  const key = `economy:suspicious:idem:${hour}:${characterId}`
  const redis = getRedis()
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 2 * 60 * 60)
  audit('idempotency.replayed', { characterId, scope, count, hour })
  if (count > BalanceConfig.economy.suspicious.idempotencyReplaysPerHourMax) {
    audit('economy.suspicious', { type: 'EXCESSIVE_IDEMPOTENCY_REPLAYS', characterId, scope, count, hour })
  }
}

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
  if (existing && existing.expiresAt > now) {
    await recordIdempotencyReplay(params.characterId, params.scope)
    return { ...(existing.responseJson as T), replayed: true }
  }

  try {
    return await withTransaction(async tx => {
      const inside = await tx.idempotencyKey.findUnique({ where })
      if (inside?.expiresAt && inside.expiresAt > new Date()) {
        void recordIdempotencyReplay(params.characterId, params.scope).catch(() => undefined)
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
      await recordIdempotencyReplay(params.characterId, params.scope)
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
