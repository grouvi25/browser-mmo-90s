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
  | 'battle.action'
  | 'battle.finished'
  | 'battle.cleanup.orphaned'
  | 'money.changed'
  | 'admin.action'

export function audit(
  event: AuditEvent,
  payload: Record<string, unknown>
): void {
  logger.info({ audit: true, event, ...payload }, `[AUDIT] ${event}`)
}
