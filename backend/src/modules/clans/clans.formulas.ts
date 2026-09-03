export const CLAN_CREATE_COST = 25000
export const CLAN_MIN_LEVEL = 5
export const CLAN_MAINTENANCE_DAILY = 500
export const CLAN_FREEZE_DEBT = 1500
export const CLAN_REJOIN_HOURS = 48
export const CLAN_RELATION_COOLDOWN_HOURS = 24

// WAR — право Этапа 4: заявка на территорию, диверсия, ограбление.
// Имя без префикса, по конвенции остальных: не CLAN_WAR.
// Управление объектами клана берёт существующее OBJECTS — заводить
// рядом второе право на то же действие незачем.
export type ClanPermission = 'INVITE'|'KICK'|'ASSIGN_ROLE'|'STORAGE_PUT'|'STORAGE_TAKE'|'TREASURY_PUT'|'TREASURY_SPEND'|'RELATIONS'|'OBJECTS'|'EDIT'|'WAR'

export const DEFAULT_ROLES = [
  { code: 'boss', name: 'Главарь', rank: 100, permissions: ['INVITE','KICK','ASSIGN_ROLE','STORAGE_PUT','STORAGE_TAKE','TREASURY_PUT','TREASURY_SPEND','RELATIONS','OBJECTS','EDIT','WAR'] },
  { code: 'brigadier', name: 'Бригадир', rank: 70, permissions: ['INVITE','KICK','STORAGE_PUT','STORAGE_TAKE','TREASURY_PUT','TREASURY_SPEND','OBJECTS','WAR'] },
  { code: 'fighter', name: 'Боец', rank: 40, permissions: ['STORAGE_PUT','STORAGE_TAKE','TREASURY_PUT'] },
  { code: 'infantry', name: 'Пехота', rank: 10, permissions: ['STORAGE_PUT','TREASURY_PUT'] },
] as const

export function clanMemberCapacity(level: number): number { return 10 + Math.max(0, level) * 5 }
export function clanStorageCapacity(level: number): number { return 30 + Math.max(0, level) * 15 }
export function storageWithdrawDailyLimit(roleCode: string): number { return roleCode === 'brigadier' ? 10 : roleCode === 'fighter' ? 3 : roleCode === 'boss' ? Number.MAX_SAFE_INTEGER : 0 }
export function treasurySpendDailyLimit(roleCode: string): number { return roleCode === 'brigadier' ? 20000 : roleCode === 'boss' ? Number.MAX_SAFE_INTEGER : 0 }
export function relationPriceMultiplier(relation: 'SELF'|'ALLY'|'NEUTRAL'|'ENEMY'): number { return relation === 'SELF' ? 0.90 : relation === 'ALLY' ? 0.95 : relation === 'ENEMY' ? 1.25 : 1 }
