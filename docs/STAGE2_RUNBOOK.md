# Stage 2 Economy Core runbook

## Deploy

1. Back up PostgreSQL with `infra/deploy/backup.sh`.
2. Run `npx prisma migrate deploy` from `backend`.
3. Run `npm run db:seed` to upsert 13 resources, 6 production objects, 5 tier-2 items and 9 private-shop positions.
4. Build and restart backend, frontend and worker.
5. Verify `/health`, then run the Stage 2 smoke flow.

## Smoke flow

1. Start, finalize and claim a work shift. Verify salary, PL exp, resources and ProductionLog.
2. Sell one resource to government twice with the same Idempotency-Key. Verify one payout.
3. Buy tier-2 gear or parts from a private shop.
4. Create item and resource market listings. Verify listing fee and reservation.
5. Buy a listing as another player. Verify ownership, money, tax and seller link.
6. Preview and commit an upgrade. Verify money and parts are burned on success and failure.
7. Repair tier-2 gear. Verify the configured repair part is consumed.
8. Verify admin economy overview, market lock/unlock and recent resource logs.

## Workers

The worker process must run as a singleton. It executes battle cleanup, HP recovery, battle timeout, work-shift finalize every 30 seconds, and market expiry every 5 minutes.

## Rollback

Code rollback is safe because Stage 2 migrations are additive. Do not roll back the database automatically. Restore the pre-deploy backup only after explicit incident review.

## Validation commands

```bash
cd backend
npm run typecheck
npm test -- --run
npx vitest run --config vitest.integration.config.ts
npx vitest run --config vitest.e2e.config.ts src/tests/e2e/economy-cycle.e2e.test.ts
cd ..
backend/node_modules/.bin/tsx scripts/simulate-economy.ts --days 30 --players 1000 --seed 42
backend/node_modules/.bin/tsx scripts/simulate-balance.ts --zonal
```
