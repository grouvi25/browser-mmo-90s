// =============================================================
// Права в админке (правка 30.10: личные входы и роли сотрудников).
//
// Сервер проверяет не роль, а право: каждая ручка админки требует одно
// право, роль — это набор прав. Так новую роль можно собрать из готовых
// прав, не трогая ручки, а админка показывает только разрешённые разделы.
// =============================================================
import type { AdminRole, StaffRole } from '@prisma/client'

export const PERMISSIONS = {
  view: 'Просмотр: игроки, журналы, мир, экономика',
  moderate: 'Наказания: бан, мут, тюрьма, чат, лоты, сигналы',
  support: 'Обращения игроков',
  content: 'Объявления и окно при входе',
  catalog: 'Справочник: вещи, магазины, сырьё',
  balance: 'Параметры баланса и формул',
  grant: 'Выдача: деньги, опыт, вещи, премиум, откаты',
  finance: 'Выплаты рефералам',
  staff: 'Сотрудники и роли',
} as const

export type Permission = keyof typeof PERMISSIONS

const ALL = Object.keys(PERMISSIONS) as Permission[]

export const STAFF_ROLES: Record<StaffRole, { title: string; permissions: Permission[] }> = {
  OWNER: { title: 'Владелец', permissions: ALL },
  ADMIN: { title: 'Администратор', permissions: ALL.filter(p => p !== 'staff') },
  GAMEDESIGNER: { title: 'Геймдизайнер', permissions: ['view', 'catalog', 'balance'] },
  MODERATOR: { title: 'Модератор', permissions: ['view', 'moderate', 'content', 'support'] },
  SUPPORT: { title: 'Поддержка', permissions: ['view', 'support'] },
  FINANCE: { title: 'Финансы', permissions: ['view', 'finance'] },
}

/** Старые учётки админки (общий «admin») — те же права, что были у их ролей. */
export const LEGACY_PERMISSIONS: Record<AdminRole, Permission[]> = {
  SUPER_ADMIN: ALL,
  MODERATOR: STAFF_ROLES.MODERATOR.permissions,
  SUPPORT: STAFF_ROLES.SUPPORT.permissions,
}

/** Роль для журнала действий (admin_action_logs хранит прежние три роли). */
export function journalRole(role: StaffRole): AdminRole {
  if (role === 'OWNER' || role === 'ADMIN') return 'SUPER_ADMIN'
  if (role === 'MODERATOR') return 'MODERATOR'
  return 'SUPPORT'
}
