import { api } from './client'

export type ClanPermission =
  | 'INVITE' | 'KICK' | 'ASSIGN_ROLE'
  | 'STORAGE_PUT' | 'STORAGE_TAKE'
  | 'TREASURY_PUT' | 'TREASURY_SPEND'
  | 'RELATIONS' | 'OBJECTS' | 'EDIT'

export const CLAN_PERMISSIONS: readonly { code: ClanPermission; label: string }[] = [
  { code: 'INVITE', label: 'Приглашать' },
  { code: 'KICK', label: 'Исключать' },
  { code: 'ASSIGN_ROLE', label: 'Назначать роли' },
  { code: 'STORAGE_PUT', label: 'Класть на склад' },
  { code: 'STORAGE_TAKE', label: 'Брать со склада' },
  { code: 'TREASURY_PUT', label: 'Пополнять общак' },
  { code: 'TREASURY_SPEND', label: 'Тратить общак' },
  { code: 'RELATIONS', label: 'Устанавливать отношения' },
  { code: 'OBJECTS', label: 'Управлять объектами' },
  { code: 'EDIT', label: 'Редактировать бригаду' },
]

export interface ClanRole { id: string; code: string; name: string; rank: number; permissions: ClanPermission[] }
export interface ClanMember {
  id: string
  characterId: string
  role: ClanRole
  joinedAt?: string
  character?: { id: string; nickname: string; battleLevel: number }
}
export interface ClanRelation {
  id: string
  fromClanId: string
  toClanId: string
  type: 'ALLIANCE' | 'HOSTILITY'
  confirmed: boolean
  updatedAt?: string
}
export interface ClanStorageRow { resourceCode: string; amount: number }

export interface Clan {
  id: string
  name: string
  tag: string
  level: number
  treasury: number
  maintenanceDebt: number
  isFrozen: boolean
  memberCapacity?: number
  storageCapacity?: number
  members?: ClanMember[]
  roles?: ClanRole[]
  storage?: ClanStorageRow[]
  relationsFrom?: ClanRelation[]
  relationsTo?: ClanRelation[]
  _count?: { members: number }
}

export const clansApi = {
  list: () => api.get<{ items: Clan[] }>('/api/clans'),
  get: (id: string) => api.get<Clan>(`/api/clans/${id}`),
  create: (name: string, tag: string) => api.post<Clan>('/api/clans', { name, tag }),
  invite: (targetCharacterId: string) => api.post('/api/clans/invite', { targetCharacterId }),
  accept: (inviteId: string) => api.post(`/api/clans/invites/${inviteId}/accept`),
  leave: () => api.post('/api/clans/leave'),
  kick: (targetCharacterId: string) => api.post('/api/clans/kick', { targetCharacterId }),
  assignRole: (targetCharacterId: string, roleId: string) =>
    api.patch('/api/clans/role', { targetCharacterId, roleId }),
  updateRole: (roleId: string, name: string, permissions: ClanPermission[]) =>
    api.patch(`/api/clans/roles/${roleId}`, { name, permissions }),

  deposit: (amount: number) => api.post('/api/clans/treasury/deposit', { amount }),
  spend: (amount: number, reason: string) => api.post('/api/clans/treasury/spend', { amount, reason }),
  storageDeposit: (resourceCode: string, amount: number) =>
    api.post('/api/clans/storage/deposit', { resourceCode, amount }),
  storageWithdraw: (resourceCode: string, amount: number) =>
    api.post('/api/clans/storage/withdraw', { resourceCode, amount }),
  relation: (targetClanId: string, type: 'ALLIANCE' | 'HOSTILITY') =>
    api.put(`/api/clans/relations/${targetClanId}`, { type }),
}
