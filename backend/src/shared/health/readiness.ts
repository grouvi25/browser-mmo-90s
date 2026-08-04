export type DependencyStatus = 'ok' | 'error'

export interface ReadinessResult {
  status: 'ready' | 'not_ready'
  checks: { postgres: DependencyStatus; redis: DependencyStatus }
  ts: string
}

async function withReadinessTimeout(check: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      check,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Readiness check timed out')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function checkReadiness(
  postgresCheck: () => Promise<unknown>,
  redisCheck: () => Promise<unknown>,
  timeoutMs = 2_000,
): Promise<ReadinessResult> {
  const [postgres, redis] = await Promise.allSettled([
    withReadinessTimeout(postgresCheck(), timeoutMs),
    withReadinessTimeout(redisCheck(), timeoutMs),
  ])
  const checks = {
    postgres: postgres.status === 'fulfilled' ? 'ok' : 'error',
    redis: redis.status === 'fulfilled' ? 'ok' : 'error',
  } as const
  return {
    status: checks.postgres === 'ok' && checks.redis === 'ok' ? 'ready' : 'not_ready',
    checks,
    ts: new Date().toISOString(),
  }
}
