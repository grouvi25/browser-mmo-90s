import type { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { EconomyService } from '../economy/economy.service'
import { ResourcesService } from '../resources/resources.service'
import { clanObjectLimit } from '../production/ownership.service'
import { CLAN_CREATE_COST, CLAN_MIN_LEVEL, CLAN_REJOIN_HOURS, CLAN_RELATION_COOLDOWN_HOURS, DEFAULT_ROLES, clanMemberCapacity, clanStorageCapacity, storageWithdrawDailyLimit, treasurySpendDailyLimit, type ClanPermission } from './clans.formulas'

function permissions(role: { permissions: Prisma.JsonValue }): string[] {
  return Array.isArray(role.permissions) ? role.permissions.filter((value): value is string => typeof value === 'string') : []
}

/** Больше иконке не нужно: клиент ужимает её до 64×64. */
export const CLAN_ICON_MAX_BYTES = 100_000

async function memberWithPermission(tx: Prisma.TransactionClient, characterId: string, permission: ClanPermission) {
  const member = await tx.clanMember.findUnique({ where: { characterId }, include: { role: true, clan: true } })
  if (!member || member.status !== 'ACTIVE') throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Вы не состоите в бригаде', 404)
  if (!permissions(member.role).includes(permission)) throw new AppError(ErrorCode.CLAN_PERMISSION, 'У вас нет на это прав в бригаде', 403)
  return member
}

/** Свободный служебный тег из четырёх знаков. */
async function freeTag(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const tag = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, 'X')
    if (!(await tx.clan.findUnique({ where: { tag }, select: { id: true } }))) return tag
  }
  throw new AppError(ErrorCode.CLAN_REQUIREMENTS, 'Не удалось зарегистрировать бригаду, попробуйте ещё раз', 409)
}

function sameUtcDay(left: Date | null, right = new Date()): boolean {
  return !!left && left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10)
}

export const ClansService = {
  // Список для Домов бригад: только публичное — общак и долги чужим не нужны.
  async list() {
    const [clans, sieges] = await Promise.all([
      prisma.clan.findMany({
        select: {
          id: true, name: true, tag: true, level: true, houseDurability: true, houseRazedUntil: true, iconVersion: true,
          _count: { select: { members: { where: { status: 'ACTIVE' } } } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.houseSiege.findMany({
        where: { status: { in: ['SCHEDULED', 'IN_BATTLE'] } },
        select: { defenderClanId: true, startsAt: true, status: true },
      }),
    ])
    const underSiege = new Map(sieges.map(s => [s.defenderClanId, s]))
    return clans.map(clan => ({ ...clan, siege: underSiege.get(clan.id) ?? null }))
  },

  async get(clanId: string) {
    const clan = await prisma.clan.findUnique({
      where: { id: clanId },
      include: { roles: { orderBy: { rank: 'desc' } }, members: { where: { status: 'ACTIVE' }, include: { role: true } }, storage: true, relationsFrom: true, relationsTo: true },
    })
    if (!clan) throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Бригада не найдена', 404)
    const characters = await prisma.character.findMany({ where: { id: { in: clan.members.map(member => member.characterId) } }, select: { id: true, nickname: true, battleLevel: true } })
    const byId = new Map(characters.map(character => [character.id, character]))
    // В таблице склада был виден код ресурса (res_greens): подставляем название.
    const resourceNames = new Map((await prisma.resourceTemplate.findMany({
      where: { code: { in: clan.storage.map(row => row.resourceCode) } }, select: { code: true, name: true },
    })).map(r => [r.code, r.name]))
    const storage = clan.storage.map(row => ({ ...row, resourceName: resourceNames.get(row.resourceCode) ?? row.resourceCode }))
    // Объекты, переданные бригаде, и её районы — в управлении бригадой
    // (правка заказчика 21.10: передать объект можно, а увидеть — негде).
    const [objects, territories] = await Promise.all([
      prisma.productionObject.findMany({
        where: { ownerType: 'CLAN', ownerClanId: clan.id },
        select: { id: true, name: true, type: true, status: true, level: true, balance: true },
        orderBy: { name: 'asc' },
      }),
      prisma.territory.findMany({
        where: { ownerClanId: clan.id, status: { not: 'NEUTRAL' } },
        select: { id: true, name: true, status: true },
        orderBy: { name: 'asc' },
      }),
    ])
    const controlled = territories.filter(row => row.status === 'CONTROLLED').length
    // Картинка иконки отдаётся отдельным адресом, в карточке — только версия.
    const { iconData: _icon, iconMime: _mime, ...plain } = clan
    void _icon; void _mime
    return { ...plain, storage, memberCapacity: clanMemberCapacity(clan.level), storageCapacity: clanStorageCapacity(clan.level), objects, objectLimit: clanObjectLimit(controlled), territories, members: clan.members.map(member => ({ ...member, character: byId.get(member.characterId) })) }
  },

  /** Иконка бригады (правка заказчика 21.10): ставит глава — право EDIT. */
  async setIcon(characterId: string, dataUrl: string) {
    const parsed = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (!parsed) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Иконка: картинка PNG, JPEG или WebP', 422)
    if (Buffer.byteLength(parsed[2], 'base64') > CLAN_ICON_MAX_BYTES) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Иконка слишком большая: не больше 100 КБ', 422)
    }
    return withTransaction(async tx => {
      const member = await memberWithPermission(tx, characterId, 'EDIT')
      // Иконка ставится один раз — при регистрации бригады; потом менять
      // нельзя (правка заказчика 22.10). Бригада без иконки ставит её один раз.
      const current = await tx.clan.findUniqueOrThrow({ where: { id: member.clanId }, select: { iconVersion: true } })
      if (current.iconVersion > 0) throw new AppError(ErrorCode.CONFLICT, 'Иконку бригады меняют только один раз — она уже стоит', 409)
      const clan = await tx.clan.update({
        where: { id: member.clanId },
        data: { iconData: parsed[2], iconMime: parsed[1], iconVersion: { increment: 1 } },
        select: { id: true, iconVersion: true },
      })
      return clan
    })
  },

  async icon(clanId: string) {
    const clan = await prisma.clan.findUnique({ where: { id: clanId }, select: { iconData: true, iconMime: true } })
    if (!clan?.iconData || !clan.iconMime) return null
    return { mime: clan.iconMime, bytes: Buffer.from(clan.iconData, 'base64') }
  },

  /** Тег необязателен: заказчик убрал его из интерфейса («только название»),
      а в базе он уникален и нужен старым экранам и отчётам — выдаём сами. */
  async create(characterId: string, name: string, tag?: string) {
    return withTransaction(async tx => {
      const character = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
      if (character.clanId) throw new AppError(ErrorCode.CLAN_ALREADY_MEMBER, 'Вы уже состоите в бригаде', 409)
      if (character.battleLevel < CLAN_MIN_LEVEL) throw new AppError(ErrorCode.CLAN_REQUIREMENTS, 'Нужен 5-й боевой уровень', 403)
      if (await tx.clan.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } })) {
        throw new AppError(ErrorCode.CLAN_REQUIREMENTS, 'Бригада с таким названием уже есть', 409)
      }
      const finalTag = tag ? tag.toUpperCase() : await freeTag(tx)
      if (tag && await tx.clan.findUnique({ where: { tag: finalTag }, select: { id: true } })) {
        throw new AppError(ErrorCode.CLAN_REQUIREMENTS, 'Такой тег уже занят', 409)
      }
      await EconomyService.debit(tx, { characterId, amount: CLAN_CREATE_COST, reasonCode: 'CLAN_CREATE', refType: 'clan' })
      const clan = await tx.clan.create({ data: { name, tag: finalTag } })
      await tx.clanRole.createMany({ data: DEFAULT_ROLES.map(role => ({ clanId: clan.id, ...role, permissions: [...role.permissions] })) })
      const boss = await tx.clanRole.findUniqueOrThrow({ where: { clanId_code: { clanId: clan.id, code: 'boss' } } })
      await tx.clanMember.create({ data: { clanId: clan.id, characterId, roleId: boss.id } })
      await tx.character.update({ where: { id: characterId }, data: { clanId: clan.id } })
      return clan
    })
  },

  /** Приглашение по нику (правка заказчика): раньше форма просила UUID
      персонажа, которого игрок нигде не видит. */
  async invite(characterId: string, target: { characterId?: string; nickname?: string }) {
    return withTransaction(async tx => {
      const member = await memberWithPermission(tx, characterId, 'INVITE')
      if (member.clan.isFrozen) throw new AppError(ErrorCode.CLAN_FROZEN, 'Бригада заморожена за долги', 409)
      const count = await tx.clanMember.count({ where: { clanId: member.clanId, status: 'ACTIVE' } })
      if (count >= clanMemberCapacity(member.clan.level)) throw new AppError(ErrorCode.CLAN_CAPACITY, 'В бригаде нет мест', 409)
      const found = target.characterId
        ? await tx.character.findUnique({ where: { id: target.characterId } })
        : await tx.character.findFirst({ where: { nickname: { equals: target.nickname?.trim() ?? '', mode: 'insensitive' } } })
      if (!found) throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Боец с таким ником не найден', 404)
      if (found.id === characterId) throw new AppError(ErrorCode.CLAN_ALREADY_MEMBER, 'Себя пригласить нельзя', 409)
      if (found.clanId) throw new AppError(ErrorCode.CLAN_ALREADY_MEMBER, 'Игрок уже состоит в бригаде', 409)
      // Новое приглашение заменяет прежнее. Раньше прежнее переводилось в
      // EXPIRED, и третье приглашение тому же бойцу падало на уникальном
      // индексе (бригада, боец, статус).
      await tx.clanInvite.deleteMany({ where: { clanId: member.clanId, characterId: found.id, status: { in: ['PENDING', 'EXPIRED', 'DECLINED'] } } })
      const invite = await tx.clanInvite.create({ data: { clanId: member.clanId, characterId: found.id, invitedById: characterId, expiresAt: new Date(Date.now() + 48 * 3_600_000) } })
      return { ...invite, nickname: found.nickname }
    })
  },

  /** Входящие приглашения: без этого списка принять приглашение было негде. */
  async myInvites(characterId: string) {
    const invites = await prisma.clanInvite.findMany({
      where: { characterId, status: 'PENDING', expiresAt: { gt: new Date() } },
      include: { clan: { select: { id: true, name: true, level: true } } },
      orderBy: { createdAt: 'desc' },
    })
    const inviters = await prisma.character.findMany({
      where: { id: { in: invites.map(i => i.invitedById) } }, select: { id: true, nickname: true },
    })
    return invites.map(i => ({
      id: i.id, expiresAt: i.expiresAt, createdAt: i.createdAt, clan: i.clan,
      invitedBy: inviters.find(c => c.id === i.invitedById)?.nickname ?? null,
    }))
  },

  async decline(characterId: string, inviteId: string) {
    const removed = await prisma.clanInvite.deleteMany({ where: { id: inviteId, characterId, status: 'PENDING' } })
    if (removed.count === 0) throw new AppError(ErrorCode.CLAN_INVITE_INVALID, 'Приглашение недействительно или истекло', 409)
    return { declined: true }
  },

  async accept(characterId: string, inviteId: string) {
    return withTransaction(async tx => {
      const invite = await tx.clanInvite.findFirst({ where: { id: inviteId, characterId, status: 'PENDING', expiresAt: { gt: new Date() } }, include: { clan: true } })
      if (!invite) throw new AppError(ErrorCode.CLAN_INVITE_INVALID, 'Приглашение недействительно или истекло', 409)
      const character = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
      if (character.clanId) throw new AppError(ErrorCode.CLAN_ALREADY_MEMBER, 'Вы уже состоите в бригаде', 409)
      const old = await tx.clanMember.findUnique({ where: { characterId } })
      if (old?.leftAt && Date.now() - old.leftAt.getTime() < CLAN_REJOIN_HOURS * 3_600_000) throw new AppError(ErrorCode.CLAN_REJOIN_COOLDOWN, 'Вступить в бригаду снова пока нельзя', 409)
      const count = await tx.clanMember.count({ where: { clanId: invite.clanId, status: 'ACTIVE' } })
      if (count >= clanMemberCapacity(invite.clan.level)) throw new AppError(ErrorCode.CLAN_CAPACITY, 'В бригаде нет мест', 409)
      const role = await tx.clanRole.findUniqueOrThrow({ where: { clanId_code: { clanId: invite.clanId, code: 'infantry' } } })
      if (old) await tx.clanMember.update({ where: { id: old.id }, data: { clanId: invite.clanId, roleId: role.id, status: 'ACTIVE', joinedAt: new Date(), leftAt: null } })
      else await tx.clanMember.create({ data: { clanId: invite.clanId, characterId, roleId: role.id } })
      await tx.character.update({ where: { id: characterId }, data: { clanId: invite.clanId } })
      // Тот же уникальный индекс: вернувшийся в ту же бригаду боец уже
      // однажды принимал её приглашение.
      await tx.clanInvite.deleteMany({ where: { clanId: invite.clanId, characterId, status: 'ACCEPTED' } })
      await tx.clanInvite.update({ where: { id: invite.id }, data: { status: 'ACCEPTED' } })
      // Остальные приглашения больше не нужны: в двух бригадах не состоят.
      await tx.clanInvite.deleteMany({ where: { characterId, status: 'PENDING' } })
      return { clanId: invite.clanId }
    })
  },

  async assignRole(characterId: string, targetCharacterId: string, roleId: string) {
    return withTransaction(async tx => {
      const actor = await memberWithPermission(tx, characterId, 'ASSIGN_ROLE')
      const target = await tx.clanMember.findUnique({ where: { characterId: targetCharacterId }, include: { role: true } })
      const role = await tx.clanRole.findFirst({ where: { id: roleId, clanId: actor.clanId } })
      if (!target || target.clanId !== actor.clanId || !role) throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Боец или роль не найдены', 404)
      if (target.role.code === 'boss' && target.characterId === characterId) throw new AppError(ErrorCode.CLAN_PERMISSION, 'Главарь не может лишить себя права назначать роли', 409)
      if (target.roleId === role.id) return { member: target, roleName: role.name, changed: false as const }
      const member = await tx.clanMember.update({ where: { id: target.id }, data: { roleId: role.id } })
      return { member, roleName: role.name, clanName: actor.clan.name, changed: true as const }
    })
  },

  /**
   * Журнал склада: кто что положил и взял. Видят главарь и бригадир —
   * просьба заказчика: «чтобы глава и зам сами видели».
   */
  // Журнал хранится целиком и листается по 10 строк (правка заказчика 20.10:
  // «пусть будет 10 строк, и их можно листать 1-2-3-4-5 страница»).
  async storageLog(characterId: string, page = 1, perPage = 10) {
    const member = await prisma.clanMember.findUnique({ where: { characterId }, include: { role: true } })
    if (!member || member.status !== 'ACTIVE') throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Вы не состоите в бригаде', 404)
    if (member.role.rank < 70) throw new AppError(ErrorCode.CLAN_PERMISSION, 'Журнал склада видят главарь и бригадир', 403)
    const total = await prisma.clanStorageLog.count({ where: { clanId: member.clanId } })
    const pages = Math.max(1, Math.ceil(total / perPage))
    const current = Math.min(Math.max(1, Math.floor(page)), pages)
    const rows = await prisma.clanStorageLog.findMany({
      where: { clanId: member.clanId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (current - 1) * perPage, take: perPage,
    })
    const [people, resources] = await Promise.all([
      prisma.character.findMany({ where: { id: { in: [...new Set(rows.map(r => r.characterId))] } }, select: { id: true, nickname: true } }),
      prisma.resourceTemplate.findMany({ where: { code: { in: [...new Set(rows.map(r => r.resourceCode))] } }, select: { code: true, name: true } }),
    ])
    const who = new Map(people.map(p => [p.id, p.nickname]))
    const what = new Map(resources.map(r => [r.code, r.name]))
    return {
      items: rows.map(r => ({
        id: r.id, at: r.createdAt, nickname: who.get(r.characterId) ?? '—',
        resource: what.get(r.resourceCode) ?? r.resourceCode, amount: r.amount,
      })),
      page: current, pages, total,
    }
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
      if (member.clan.isFrozen) throw new AppError(ErrorCode.CLAN_FROZEN, 'Бригада заморожена за долги', 409)
      const spent = sameUtcDay(member.treasurySpentAt) ? member.treasurySpent : 0
      if (spent + amount > treasurySpendDailyLimit(member.role.code)) throw new AppError(ErrorCode.CLAN_DAILY_LIMIT, 'Превышен дневной лимит общака', 409)
      const changed = await tx.clan.updateMany({ where: { id: member.clanId, treasury: { gte: amount } }, data: { treasury: { decrement: amount } } })
      if (changed.count !== 1) throw new AppError(ErrorCode.ECON_INSUFFICIENT_FUNDS, 'В общаке не хватает денег', 409)
      await tx.clanMember.update({ where: { id: member.id }, data: { treasurySpent: spent + amount, treasurySpentAt: new Date() } })
      const clan = await tx.clan.findUniqueOrThrow({ where: { id: member.clanId } })
      await tx.clanTreasuryLog.create({ data: { clanId: member.clanId, characterId, amount: -amount, balanceAfter: clan.treasury, reason } })
      return { treasury: clan.treasury }
    })
  },

  async leave(characterId: string) {
    return withTransaction(async tx => {
      const member = await tx.clanMember.findUnique({ where: { characterId }, include: { role: true } })
      if (!member || member.status !== 'ACTIVE') throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Вы не состоите в бригаде', 404)
      if (member.role.code === 'boss') throw new AppError(ErrorCode.CLAN_PERMISSION, 'Сначала передайте главенство другому', 409)
      await tx.clanMember.update({ where: { id: member.id }, data: { status: 'LEFT', leftAt: new Date() } })
      await tx.character.update({ where: { id: characterId }, data: { clanId: null } })
      return { left: true as const }
    })
  },

  async kick(characterId: string, targetCharacterId: string) {
    return withTransaction(async tx => {
      const actor = await memberWithPermission(tx, characterId, 'KICK')
      const target = await tx.clanMember.findUnique({ where: { characterId: targetCharacterId }, include: { role: true } })
      if (!target || target.clanId !== actor.clanId || target.status !== 'ACTIVE') throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Боец бригады не найден', 404)
      if (target.role.rank >= actor.role.rank) throw new AppError(ErrorCode.CLAN_PERMISSION, 'Нельзя выгнать равного или старшего по роли', 403)
      await tx.clanMember.update({ where: { id: target.id }, data: { status: 'KICKED', leftAt: new Date() } })
      await tx.character.update({ where: { id: targetCharacterId }, data: { clanId: null } })
      return { kicked: true as const }
    })
  },

  async depositStorage(characterId: string, resourceCode: string, amount: number) {
    return withTransaction(async tx => {
      const member = await memberWithPermission(tx, characterId, 'STORAGE_PUT')
      const template = await tx.resourceTemplate.findUnique({ where: { code: resourceCode } })
      if (!template) throw new AppError(ErrorCode.RES_NOT_FOUND, 'Ресурс не найден', 404)
      const existing = await tx.clanStorage.findUnique({ where: { clanId_resourceCode: { clanId: member.clanId, resourceCode } } })
      if (!existing) {
        const slots = await tx.clanStorage.count({ where: { clanId: member.clanId, amount: { gt: 0 } } })
        if (slots >= clanStorageCapacity(member.clan.level)) throw new AppError(ErrorCode.CLAN_STORAGE_FULL, 'Склад бригады полон', 409)
      }
      await ResourcesService.consume(tx, { characterId, resourceTemplateId: template.id, amount, reasonCode: 'CLAN_STORAGE_DEPOSIT', refType: 'clan', refId: member.clanId })
      const row = await tx.clanStorage.upsert({ where: { clanId_resourceCode: { clanId: member.clanId, resourceCode } }, update: { amount: { increment: amount } }, create: { clanId: member.clanId, resourceCode, amount } })
      await tx.clanStorageLog.create({ data: { clanId: member.clanId, characterId, resourceCode, amount } })
      return row
    })
  },

  async withdrawStorage(characterId: string, resourceCode: string, amount: number) {
    return withTransaction(async tx => {
      const member = await memberWithPermission(tx, characterId, 'STORAGE_TAKE')
      const used = sameUtcDay(member.storageWithdrawnAt) ? member.storageWithdrawn : 0
      if (used + amount > storageWithdrawDailyLimit(member.role.code)) throw new AppError(ErrorCode.CLAN_DAILY_LIMIT, 'Превышен дневной лимит склада', 409)
      const changed = await tx.clanStorage.updateMany({ where: { clanId: member.clanId, resourceCode, amount: { gte: amount } }, data: { amount: { decrement: amount } } })
      if (changed.count !== 1) throw new AppError(ErrorCode.RES_INSUFFICIENT, 'На складе бригады не хватает', 409)
      const template = await tx.resourceTemplate.findUniqueOrThrow({ where: { code: resourceCode } })
      await ResourcesService.add(tx, { characterId, resourceTemplateId: template.id, amount, reasonCode: 'CLAN_STORAGE_WITHDRAW', refType: 'clan', refId: member.clanId })
      await tx.clanMember.update({ where: { id: member.id }, data: { storageWithdrawn: used + amount, storageWithdrawnAt: new Date() } })
      await tx.clanStorageLog.create({ data: { clanId: member.clanId, characterId, resourceCode, amount: -amount } })
      return { resourceCode, amount }
    })
  },

  async setRelation(characterId: string, targetClanId: string, type: 'ALLIANCE' | 'HOSTILITY') {
    return withTransaction(async tx => {
      const member = await memberWithPermission(tx, characterId, 'RELATIONS')
      if (targetClanId === member.clanId) throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Нельзя задать отношения со своей бригадой', 422)
      await tx.clan.findUniqueOrThrow({ where: { id: targetClanId } })
      const previous = await tx.clanRelation.findUnique({ where: { fromClanId_toClanId: { fromClanId: member.clanId, toClanId: targetClanId } } })
      if (previous && Date.now() - previous.updatedAt.getTime() < CLAN_RELATION_COOLDOWN_HOURS * 3_600_000) throw new AppError(ErrorCode.CLAN_RELATION_COOLDOWN, 'Отношения пока нельзя менять', 409)
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
      if (!role) throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Роль не найдена', 404)
      if (role.code === 'boss' && !nextPermissions.includes('ASSIGN_ROLE')) {
        throw new AppError(ErrorCode.CLAN_PERMISSION, 'У роли главаря должно остаться право назначать роли', 409)
      }
      return tx.clanRole.update({ where: { id: role.id }, data: { name, permissions: nextPermissions } })
    })
  },

}
