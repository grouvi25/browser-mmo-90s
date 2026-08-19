import type { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { EconomyService } from '../economy/economy.service'
import { ResourcesService } from '../resources/resources.service'
import { CLAN_CREATE_COST, CLAN_MIN_LEVEL, CLAN_REJOIN_HOURS, CLAN_RELATION_COOLDOWN_HOURS, DEFAULT_ROLES, clanMemberCapacity, clanStorageCapacity, storageWithdrawDailyLimit, treasurySpendDailyLimit, type ClanPermission } from './clans.formulas'

function permissions(role: { permissions: Prisma.JsonValue }): string[] {
  return Array.isArray(role.permissions) ? role.permissions.filter((value): value is string => typeof value === 'string') : []
}

async function memberWithPermission(tx: Prisma.TransactionClient, characterId: string, permission: ClanPermission) {
  const member = await tx.clanMember.findUnique({ where: { characterId }, include: { role: true, clan: true } })
  if (!member || member.status !== 'ACTIVE') throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Character is not in a clan', 404)
  if (!permissions(member.role).includes(permission)) throw new AppError(ErrorCode.CLAN_PERMISSION, 'Clan permission denied', 403)
  return member
}

function sameUtcDay(left: Date | null, right = new Date()): boolean {
  return !!left && left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10)
}

export const ClansService = {
  list: () => prisma.clan.findMany({ include: { _count: { select: { members: { where: { status: 'ACTIVE' } } } } }, orderBy: { name: 'asc' } }),

  async get(clanId: string) {
    const clan = await prisma.clan.findUnique({
      where: { id: clanId },
      include: { roles: { orderBy: { rank: 'desc' } }, members: { where: { status: 'ACTIVE' }, include: { role: true } }, storage: true, relationsFrom: true, relationsTo: true },
    })
    if (!clan) throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Clan not found', 404)
    const characters = await prisma.character.findMany({ where: { id: { in: clan.members.map(member => member.characterId) } }, select: { id: true, nickname: true, battleLevel: true } })
    const byId = new Map(characters.map(character => [character.id, character]))
    return { ...clan, memberCapacity: clanMemberCapacity(clan.level), storageCapacity: clanStorageCapacity(clan.level), members: clan.members.map(member => ({ ...member, character: byId.get(member.characterId) })) }
  },

  async create(characterId: string, name: string, tag: string) {
    return withTransaction(async tx => {
      const character = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
      if (character.clanId) throw new AppError(ErrorCode.CLAN_ALREADY_MEMBER, 'Already in a clan', 409)
      if (character.battleLevel < CLAN_MIN_LEVEL) throw new AppError(ErrorCode.CLAN_REQUIREMENTS, 'Battle level 5 is required', 403)
      await EconomyService.debit(tx, { characterId, amount: CLAN_CREATE_COST, reasonCode: 'CLAN_CREATE', refType: 'clan' })
      const clan = await tx.clan.create({ data: { name, tag: tag.toUpperCase() } })
      await tx.clanRole.createMany({ data: DEFAULT_ROLES.map(role => ({ clanId: clan.id, ...role, permissions: [...role.permissions] })) })
      const boss = await tx.clanRole.findUniqueOrThrow({ where: { clanId_code: { clanId: clan.id, code: 'boss' } } })
      await tx.clanMember.create({ data: { clanId: clan.id, characterId, roleId: boss.id } })
      await tx.character.update({ where: { id: characterId }, data: { clanId: clan.id } })
      return clan
    })
  },

  async invite(characterId: string, targetCharacterId: string) {
    return withTransaction(async tx => {
      const member = await memberWithPermission(tx, characterId, 'INVITE')
      if (member.clan.isFrozen) throw new AppError(ErrorCode.CLAN_FROZEN, 'Clan is frozen', 409)
      const count = await tx.clanMember.count({ where: { clanId: member.clanId, status: 'ACTIVE' } })
      if (count >= clanMemberCapacity(member.clan.level)) throw new AppError(ErrorCode.CLAN_CAPACITY, 'Clan is full', 409)
      const target = await tx.character.findUniqueOrThrow({ where: { id: targetCharacterId } })
      if (target.clanId) throw new AppError(ErrorCode.CLAN_ALREADY_MEMBER, 'Target is already in a clan', 409)
      await tx.clanInvite.updateMany({ where: { clanId: member.clanId, characterId: targetCharacterId, status: 'PENDING' }, data: { status: 'EXPIRED' } })
      return tx.clanInvite.create({ data: { clanId: member.clanId, characterId: targetCharacterId, invitedById: characterId, expiresAt: new Date(Date.now() + 48 * 3_600_000) } })
    })
  },

  async accept(characterId: string, inviteId: string) {
    return withTransaction(async tx => {
      const invite = await tx.clanInvite.findFirst({ where: { id: inviteId, characterId, status: 'PENDING', expiresAt: { gt: new Date() } }, include: { clan: true } })
      if (!invite) throw new AppError(ErrorCode.CLAN_INVITE_INVALID, 'Invite is invalid or expired', 409)
      const character = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
      if (character.clanId) throw new AppError(ErrorCode.CLAN_ALREADY_MEMBER, 'Already in a clan', 409)
      const old = await tx.clanMember.findUnique({ where: { characterId } })
      if (old?.leftAt && Date.now() - old.leftAt.getTime() < CLAN_REJOIN_HOURS * 3_600_000) throw new AppError(ErrorCode.CLAN_REJOIN_COOLDOWN, 'Clan rejoin cooldown is active', 409)
      const count = await tx.clanMember.count({ where: { clanId: invite.clanId, status: 'ACTIVE' } })
      if (count >= clanMemberCapacity(invite.clan.level)) throw new AppError(ErrorCode.CLAN_CAPACITY, 'Clan is full', 409)
      const role = await tx.clanRole.findUniqueOrThrow({ where: { clanId_code: { clanId: invite.clanId, code: 'infantry' } } })
      if (old) await tx.clanMember.update({ where: { id: old.id }, data: { clanId: invite.clanId, roleId: role.id, status: 'ACTIVE', joinedAt: new Date(), leftAt: null } })
      else await tx.clanMember.create({ data: { clanId: invite.clanId, characterId, roleId: role.id } })
      await tx.character.update({ where: { id: characterId }, data: { clanId: invite.clanId } })
      await tx.clanInvite.update({ where: { id: invite.id }, data: { status: 'ACCEPTED' } })
      return { clanId: invite.clanId }
    })
  },

  async assignRole(characterId: string, targetCharacterId: string, roleId: string) {
    return withTransaction(async tx => {
      const actor = await memberWithPermission(tx, characterId, 'ASSIGN_ROLE')
      const target = await tx.clanMember.findUnique({ where: { characterId }, include: { role: true } })
      const role = await tx.clanRole.findFirst({ where: { id: roleId, clanId: actor.clanId } })
      if (!target || target.clanId !== actor.clanId || !role) throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Clan member or role not found', 404)
      if (target.role.code === 'boss' && target.characterId === characterId) throw new AppError(ErrorCode.CLAN_PERMISSION, 'Boss cannot remove own role assignment power', 409)
      return tx.clanMember.update({ where: { id: target.id }, data: { roleId: role.id } })
    })
  },

  async depositTreasury(characterId: string, amount: number) {
    return withTransaction(async tx => {
      const member = await memberWithPermission(tx, characterId, 'TREASURY_PUT')
      const newBalance = await EconomyService.debit(tx, { characterId, amount, reasonCode: 'CLAN_TREASURY_DEPOSIT', refType: 'clan', refId: member.clanId })
      const debtPaid = Math.min(member.clan.maintenanceDebt, amount)
      const updated = await tx.clan.update({ where: { id: member.clanId }, data: { treasury: { increment: amount - debtPaid }, maintenanceDebt: { decrement: debtPaid }, ...(member.clan.maintenanceDebt - debtPaid < 1500 ? { isFrozen: false } : {}) } })
      await tx.clanTreasuryLog.create({ data: { clanId: member.clanId, characterId, amount, balanceAfter: updated.treasury, reason: 'DEPOSIT' } })
      return { treasury: updated.treasury, debt: updated.maintenanceDebt, newBalance }
    })
  },

  async spendTreasury(characterId: string, amount: number, reason: string) {
    return withTransaction(async tx => {
      const member = await memberWithPermission(tx, characterId, 'TREASURY_SPEND')
      if (member.clan.isFrozen) throw new AppError(ErrorCode.CLAN_FROZEN, 'Clan is frozen', 409)
      const spent = sameUtcDay(member.treasurySpentAt) ? member.treasurySpent : 0
      if (spent + amount > treasurySpendDailyLimit(member.role.code)) throw new AppError(ErrorCode.CLAN_DAILY_LIMIT, 'Daily treasury limit exceeded', 409)
      const changed = await tx.clan.updateMany({ where: { id: member.clanId, treasury: { gte: amount } }, data: { treasury: { decrement: amount } } })
      if (changed.count !== 1) throw new AppError(ErrorCode.ECON_INSUFFICIENT_FUNDS, 'Clan treasury is too low', 409)
      await tx.clanMember.update({ where: { id: member.id }, data: { treasurySpent: spent + amount, treasurySpentAt: new Date() } })
      const clan = await tx.clan.findUniqueOrThrow({ where: { id: member.clanId } })
      await tx.clanTreasuryLog.create({ data: { clanId: member.clanId, characterId, amount: -amount, balanceAfter: clan.treasury, reason } })
      return { treasury: clan.treasury }
    })
  },

  async leave(characterId: string) {
    return withTransaction(async tx => {
      const member = await tx.clanMember.findUnique({ where: { characterId }, include: { role: true } })
      if (!member || member.status !== 'ACTIVE') throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Character is not in a clan', 404)
      if (member.role.code === 'boss') throw new AppError(ErrorCode.CLAN_PERMISSION, 'Boss must transfer leadership before leaving', 409)
      await tx.clanMember.update({ where: { id: member.id }, data: { status: 'LEFT', leftAt: new Date() } })
      await tx.character.update({ where: { id: characterId }, data: { clanId: null } })
      return { left: true as const }
    })
  },

  async kick(characterId: string, targetCharacterId: string) {
    return withTransaction(async tx => {
      const actor = await memberWithPermission(tx, characterId, 'KICK')
      const target = await tx.clanMember.findUnique({ where: { characterId: targetCharacterId }, include: { role: true } })
      if (!target || target.clanId !== actor.clanId || target.status !== 'ACTIVE') throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Clan member not found', 404)
      if (target.role.rank >= actor.role.rank) throw new AppError(ErrorCode.CLAN_PERMISSION, 'Cannot kick equal or higher role', 403)
      await tx.clanMember.update({ where: { id: target.id }, data: { status: 'KICKED', leftAt: new Date() } })
      await tx.character.update({ where: { id: targetCharacterId }, data: { clanId: null } })
      return { kicked: true as const }
    })
  },

  async depositStorage(characterId: string, resourceCode: string, amount: number) {
    return withTransaction(async tx => {
      const member = await memberWithPermission(tx, characterId, 'STORAGE_PUT')
      const template = await tx.resourceTemplate.findUnique({ where: { code: resourceCode } })
      if (!template) throw new AppError(ErrorCode.RES_NOT_FOUND, 'Resource not found', 404)
      const existing = await tx.clanStorage.findUnique({ where: { clanId_resourceCode: { clanId: member.clanId, resourceCode } } })
      if (!existing) {
        const slots = await tx.clanStorage.count({ where: { clanId: member.clanId, amount: { gt: 0 } } })
        if (slots >= clanStorageCapacity(member.clan.level)) throw new AppError(ErrorCode.CLAN_STORAGE_FULL, 'Clan storage is full', 409)
      }
      await ResourcesService.consume(tx, { characterId, resourceTemplateId: template.id, amount, reasonCode: 'CLAN_STORAGE_DEPOSIT', refType: 'clan', refId: member.clanId })
      const row = await tx.clanStorage.upsert({ where: { clanId_resourceCode: { clanId: member.clanId, resourceCode } }, update: { amount: { increment: amount } }, create: { clanId: member.clanId, resourceCode, amount } })
      return row
    })
  },

  async withdrawStorage(characterId: string, resourceCode: string, amount: number) {
    return withTransaction(async tx => {
      const member = await memberWithPermission(tx, characterId, 'STORAGE_TAKE')
      const used = sameUtcDay(member.storageWithdrawnAt) ? member.storageWithdrawn : 0
      if (used + amount > storageWithdrawDailyLimit(member.role.code)) throw new AppError(ErrorCode.CLAN_DAILY_LIMIT, 'Daily storage limit exceeded', 409)
      const changed = await tx.clanStorage.updateMany({ where: { clanId: member.clanId, resourceCode, amount: { gte: amount } }, data: { amount: { decrement: amount } } })
      if (changed.count !== 1) throw new AppError(ErrorCode.RES_INSUFFICIENT, 'Clan resource amount is too low', 409)
      const template = await tx.resourceTemplate.findUniqueOrThrow({ where: { code: resourceCode } })
      await ResourcesService.add(tx, { characterId, resourceTemplateId: template.id, amount, reasonCode: 'CLAN_STORAGE_WITHDRAW', refType: 'clan', refId: member.clanId })
      await tx.clanMember.update({ where: { id: member.id }, data: { storageWithdrawn: used + amount, storageWithdrawnAt: new Date() } })
      return { resourceCode, amount }
    })
  },

  async setRelation(characterId: string, targetClanId: string, type: 'ALLIANCE' | 'HOSTILITY') {
    return withTransaction(async tx => {
      const member = await memberWithPermission(tx, characterId, 'RELATIONS')
      if (targetClanId === member.clanId) throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Cannot set relation with own clan', 422)
      await tx.clan.findUniqueOrThrow({ where: { id: targetClanId } })
      const previous = await tx.clanRelation.findUnique({ where: { fromClanId_toClanId: { fromClanId: member.clanId, toClanId: targetClanId } } })
      if (previous && Date.now() - previous.updatedAt.getTime() < CLAN_RELATION_COOLDOWN_HOURS * 3_600_000) throw new AppError(ErrorCode.CLAN_RELATION_COOLDOWN, 'Relation cooldown is active', 409)
      const reverse = await tx.clanRelation.findUnique({ where: { fromClanId_toClanId: { fromClanId: targetClanId, toClanId: member.clanId } } })
      const confirmed = type === 'HOSTILITY' || reverse?.type === 'ALLIANCE'
      const relation = await tx.clanRelation.upsert({ where: { fromClanId_toClanId: { fromClanId: member.clanId, toClanId: targetClanId } }, update: { type, confirmed }, create: { fromClanId: member.clanId, toClanId: targetClanId, type, confirmed } })
      if (confirmed && type === 'ALLIANCE' && reverse) await tx.clanRelation.update({ where: { id: reverse.id }, data: { confirmed: true } })
      return relation
    })
  },


  async updateRole(characterId: string, roleId: string, name: string, nextPermissions: ClanPermission[]) {
    return withTransaction(async tx => {
      const actor = await memberWithPermission(tx, characterId, 'ASSIGN_ROLE')
      const role = await tx.clanRole.findFirst({ where: { id: roleId, clanId: actor.clanId } })
      if (!role) throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Clan role not found', 404)
      if (role.code === 'boss' && !nextPermissions.includes('ASSIGN_ROLE')) {
        throw new AppError(ErrorCode.CLAN_PERMISSION, 'Boss role must keep ASSIGN_ROLE', 409)
      }
      return tx.clanRole.update({ where: { id: role.id }, data: { name, permissions: nextPermissions } })
    })
  },

}
