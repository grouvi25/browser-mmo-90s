import { prisma } from './prisma'
import { Prisma } from '@prisma/client'

export interface TransactionOptions {
  maxWait?: number
  timeout?: number
  isolationLevel?: Prisma.TransactionIsolationLevel
  retries?: number
}

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
}

/**
 * Run multiple operations in a serializable PostgreSQL transaction.
 * Serialization/deadlock conflicts are retried with a short bounded backoff.
 */
export async function withTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const retries = options.retries ?? 3

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        maxWait: options.maxWait ?? 5000,
        timeout: options.timeout ?? 10000,
        isolationLevel: options.isolationLevel ?? Prisma.TransactionIsolationLevel.Serializable,
      })
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt >= retries) throw error
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
}

export async function withBatchTransaction<T>(
  operations: Prisma.PrismaPromise<T>[],
): Promise<T[]> {
  return prisma.$transaction(operations, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  })
}
