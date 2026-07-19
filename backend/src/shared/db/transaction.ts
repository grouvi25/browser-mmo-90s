import { prisma } from './prisma'
import type { Prisma } from '@prisma/client'

/**
 * Run multiple operations in a single PostgreSQL transaction.
 * Uses Prisma's interactive transactions for complex use-cases.
 */
export async function withTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number }
): Promise<T> {
  return prisma.$transaction(fn, {
    maxWait: options?.maxWait ?? 5000,
    timeout: options?.timeout ?? 10000,
  })
}

/**
 * Batch operations in a single transaction (simpler API).
 */
export async function withBatchTransaction<T>(
  operations: Prisma.PrismaPromise<T>[]
): Promise<T[]> {
  return prisma.$transaction(operations)
}
