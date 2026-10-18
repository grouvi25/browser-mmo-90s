import { logger } from './logger'

type AuditEvent =
  | 'user.registered'
  | 'user.login'
  | 'user.logout'
  | 'user.login_failed'
  | 'character.created'
  | 'item.purchased'
  | 'item.sold'
  | 'item.discarded'
  | 'item.equipped'
  | 'item.unequipped'
  | 'item.repaired'
  | 'battle.started'
  | 'battle.cleanup.legacy_waiting'
  | 'house_siege.filed'
  | 'house_siege.started'
  | 'house_siege.finished'
  | 'battle.application.created'
  | 'battle.application.started'
  | 'battle.application.cancelled'
  | 'battle.action'
  | 'battle.finished'
  | 'battle.cleanup.orphaned'
  | 'battle.cleanup.released'
  | 'money.changed'
  | 'admin.action'
  | 'economy.suspicious'
  | 'idempotency.replayed'

export function audit(
  event: AuditEvent,
  payload: Record<string, unknown>
): void {
  logger.info({ audit: true, event, ...payload }, `[AUDIT] ${event}`)
}
