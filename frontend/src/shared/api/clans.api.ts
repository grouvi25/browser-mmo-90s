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
export interface ClanStorageRow { resourceCode: string; resourceName?: string; amount: number }

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
  /** Дом бригады: прочность и разгром — в списке Домов бригад. */
  houseDurability?: number
  houseRazedUntil?: string | null
  siege?: { startsAt: string; status: 'SCHEDULED' | 'IN_BATTLE' } | null
}

export interface HouseFighter { id: string; nickname: string; battleLevel: number }
export interface BrigadeHouse {
  id: string; name: string; tag: string; level: number
  durability: number
  razedUntil: string | null
  bonusesOff: boolean
  repairCost: number
  members: Array<HouseFighter & { role: string; rank: number }>
  isMine: boolean
  canRepair: boolean
  canFile: boolean
  fileBlocked: string | null
  canWrite: boolean
  rules: {
    minLead: string; minLeadHours: number; maxLeadDays: number; fromHour: number; toHour: number; weekdaysOnly: boolean
    traumaHours: number; cooldownDays: number; razedDays: number; durabilityLoss: number; maxPerSide: number
  }
  wall: Array<{ id: string; author: string; text: string; createdAt: string }>
  outgoing: BrigadeHouse['siege']
  siege: null | {
    id: string
    status: 'SCHEDULED' | 'IN_BATTLE'
    startsAt: string
    attacker: { id: string; name: string; tag: string } | null
    defender: { id: string; name: string; tag: string } | null
    attackers: HouseFighter[]
    defenders: HouseFighter[]
    mySide: 1 | 2 | null
    signedUp: boolean
    canCancel: boolean
    battleId: string | null
  }
}

export interface ClanInvite {
  id: string
  expiresAt: string
  createdAt: string
  clan: { id: string; name: string; level: number }
  invitedBy: string | null
}

export const clansApi = {
  list: () => api.get<{ items: Clan[] }>('/api/clans'),
  get: (id: string) => api.get<Clan>(`/api/clans/${id}`),
  storageLog: () => api.get<{ items: Array<{ id: string; at: string; nickname: string; resource: string; amount: number }> }>('/api/clans/storage/log'),
  house: (id: string) => api.get<BrigadeHouse>(`/api/clans/${id}/house`),
  fileSiege: (id: string, startsAt: string) => api.post<{ siegeId: string; startsAt: string }>(`/api/clans/${id}/siege`, { startsAt }),
  siegeAction: (siegeId: string, action: 'signup' | 'unsign' | 'cancel') => api.post(`/api/clans/sieges/${siegeId}/${action}`, {}),
  repairHouse: () => api.post<{ durability: number; cost: number; treasury: number }>('/api/clans/house/repair', {}),
  writeOnWall: (id: string, text: string) => api.post(`/api/clans/${id}/wall`, { text }),
  create: (name: string) => api.post<Clan>('/api/clans', { name }),
  invite: (nickname: string) => api.post<{ nickname: string }>('/api/clans/invite', { nickname }),
  myInvites: () => api.get<{ items: ClanInvite[] }>('/api/clans/invites/mine'),
  accept: (inviteId: string) => api.post(`/api/clans/invites/${inviteId}/accept`),
  decline: (inviteId: string) => api.post(`/api/clans/invites/${inviteId}/decline`),
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
