import type { UpgradeType } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { withIdempotency } from '../../shared/db/idempotency'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { EconomyService } from '../economy/economy.service'
import { ResourcesService } from '../resources/resources.service'
import { craftProfessionForItem } from '../professions/professions'
import { applyUpgradeModifiers, calcUpgradeCost, calcUpgradeSuccessChance, craftUpgradeCost, isUpgradeCompatible, requiredUpgradeResource, type UpgradeKind } from './upgrades.formulas'
import { BalanceConfig } from '../../config/balance.config'
import type { Prisma } from '@prisma/client'

/**
 * Крафт (Дима 17.11): вещь из крафта улучшается не процентами, а очками на раскладку:
 * +20 за уровень. №195 (Миша 26.11): платится по одной формуле от уровня вещи и
 * номера улучшения (craftUpgradeCost) — раньше ресурсы брались из рецепта вещи, и
 * две вещи одного уровня улучшались за разное.
 */
const MAX_LEVEL = 5
type Db = Prisma.TransactionClient | typeof prisma
function isPointsUpgrade(item: { sourceType: string }): boolean {
  return item.sourceType === 'CRAFTED'
}
async function resourceAvailability(db: Db, characterId: string, needs: { code: string; amount: number }[]) {
  const templates = await db.resourceTemplate.findMany({ where: { code: { in: needs.map(n => n.code) } }, select: { id: true, code: true, name: true } })
  const stacks = await db.resourceStack.findMany({ where: { characterId, resourceTemplateId: { in: templates.map(t => t.id) } } })
  return needs.map(need => {
    const template = templates.find(t => t.code === need.code)
    const stack = stacks.find(row => row.resourceTemplateId === template?.id)
    const available = (stack?.amount ?? 0) - (stack?.reservedAmount ?? 0)
    return { resourceCode: need.code, resourceTemplateId: template?.id, resourceName: template?.name ?? need.code, amount: need.amount, available, enough: !!template && available >= need.amount }
  })
}

async function professionLevel(characterId: string, itemType: string, configuredCode?: string | null) {
  const professionCode = configuredCode ?? craftProfessionForItem(itemType)
  const profession = await prisma.characterProfession.findUnique({
    where: { characterId_professionCode: { characterId, professionCode } },
  })
  return { professionCode, level: profession?.level ?? 0 }
}

export const UpgradesService = {
  async items(characterId: string) {
    return prisma.itemInstance.findMany({
      where: {
        ownerId: characterId, status: { notIn: ['DELETED', 'CONSUMED', 'BROKEN', 'ON_MARKET'] },
        OR: [
          { template: { type: { in: ['WEAPON', 'ARMOR'] }, upgradeAllowed: true } },
          // Крафтовые вещи улучшаются очками, в том числе кольца и амулеты.
          { sourceType: 'CRAFTED', template: { type: { in: ['WEAPON', 'ARMOR', 'ACCESSORY', 'SHIELD'] }, upgradeAllowed: true } },
        ],
      },
      include: { template: true },
    })
  },

  async preview(characterId: string, itemInstanceId: string, upgradeType: UpgradeKind) {
    const character = await prisma.character.findUniqueOrThrow({ where: { id: characterId } })
    const item = await prisma.itemInstance.findUnique({ where: { id: itemInstanceId }, include: { template: true } })
    if (!item || item.ownerId !== characterId) throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Not your item', 403)
    if (isPointsUpgrade(item)) return UpgradesService.previewPoints(character, item)
    if (!item.template.upgradeAllowed || !isUpgradeCompatible(item.template.type, upgradeType)) throw new AppError(ErrorCode.UPG_INVALID_TYPE, 'Upgrade type is incompatible', 400)
    if (item.status === 'BROKEN' || item.status === 'ON_MARKET') throw new AppError(ErrorCode.UPG_ITEM_STATE, 'Item cannot be upgraded', 409)
    if (item.upgradeLevel >= MAX_LEVEL) throw new AppError(ErrorCode.UPG_MAX_LEVEL, 'Maximum upgrade level reached', 400)
    const next = item.upgradeLevel + 1
    const cost = calcUpgradeCost(item.template.priceBase, next)
    const craft = await professionLevel(characterId, item.template.type, item.template.craftProfessionCode)
    const chance = calcUpgradeSuccessChance(item.upgradeLevel, craft.level)
    const required = requiredUpgradeResource(item.template.type, next)
    const template = await prisma.resourceTemplate.findUniqueOrThrow({ where: { code: required.code } })
    const stack = await prisma.resourceStack.findUnique({ where: { characterId_resourceTemplateId: { characterId, resourceTemplateId: template.id } } })
    const available = (stack?.amount ?? 0) - (stack?.reservedAmount ?? 0)
    const mods = (item.upgradeModifiersJson as Partial<Record<UpgradeKind, number>> | null) ?? {}
    const nextMods = { ...mods, [upgradeType]: (mods[upgradeType] ?? 0) + 1 }
    return {
      mode: 'MODIFIERS' as const,
      itemId: item.id, upgradeType, currentTotalLevel: item.upgradeLevel, nextTotalLevel: next,
      cost, chance, profession: craft,
      requiredResources: [{ resourceCode: required.code, resourceName: template.name, amount: required.amount, available, enough: available >= required.amount }],
      canCommit: character.money >= cost && available >= required.amount,
      effectiveStats: applyUpgradeModifiers(item.template, nextMods, item.statAllocation, item.socketsJson),
    }
  },

  /** Предпросмотр улучшения крафтовой вещи: +20 очков за ресурсы её рецепта. */
  async previewPoints(
    character: { id: string; money: number },
    item: { id: string; upgradeLevel: number; extraPoints: number; status: string; template: { code: string; type: string; priceBase: number; levelReq: number; statBudget: number; upgradeAllowed: boolean; craftProfessionCode: string | null } },
  ) {
    if (!item.template.upgradeAllowed) throw new AppError(ErrorCode.UPG_INVALID_TYPE, 'Эту вещь улучшать нельзя', 400)
    if (item.status === 'BROKEN' || item.status === 'ON_MARKET') throw new AppError(ErrorCode.UPG_ITEM_STATE, 'Item cannot be upgraded', 409)
    if (item.upgradeLevel >= MAX_LEVEL) throw new AppError(ErrorCode.UPG_MAX_LEVEL, 'Maximum upgrade level reached', 400)
    const next = item.upgradeLevel + 1
    const price = craftUpgradeCost(item.template.levelReq, next)
    const cost = price.money
    const craft = await professionLevel(character.id, item.template.type, item.template.craftProfessionCode)
    const chance = calcUpgradeSuccessChance(item.upgradeLevel, craft.level)
    const required = await resourceAvailability(prisma, character.id, price.resources)
    const gain = BalanceConfig.economy.crafting.upgradePoints
    return {
      mode: 'POINTS' as const,
      itemId: item.id, upgradeType: 'POINTS', currentTotalLevel: item.upgradeLevel, nextTotalLevel: next,
      cost, chance, profession: craft, pointsGain: gain,
      budgetNow: item.template.statBudget + item.extraPoints, budgetAfter: item.template.statBudget + item.extraPoints + gain,
      requiredResources: required.map(row => ({ resourceCode: row.resourceCode, resourceName: row.resourceName, amount: row.amount, available: row.available, enough: row.enough })),
      canCommit: character.money >= cost && required.every(row => row.enough),
      effectiveStats: {},
    }
  },

  async commit(characterId: string, itemInstanceId: string, upgradeType: UpgradeKind, key: string, rng = Math.random) {
    return withIdempotency({ characterId, scope: 'upgrades.commit', key, execute: async tx => {
      const character = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
      if (['IN_BATTLE', 'WORKING'].includes(character.status)) throw new AppError(ErrorCode.UPG_CHARACTER_BUSY, 'Character is busy', 409)
      const item = await tx.itemInstance.findUnique({ where: { id: itemInstanceId }, include: { template: true } })
      if (!item || item.ownerId !== characterId) throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Not your item', 403)
      if (isPointsUpgrade(item)) {
        if (!item.template.upgradeAllowed) throw new AppError(ErrorCode.UPG_NOT_ALLOWED, 'Upgrade unavailable', 400)
        if (item.status === 'BROKEN' || item.status === 'ON_MARKET') throw new AppError(ErrorCode.UPG_ITEM_STATE, 'Item cannot be upgraded', 409)
        if (item.upgradeLevel >= MAX_LEVEL) throw new AppError(ErrorCode.UPG_MAX_LEVEL, 'Maximum upgrade level reached', 400)
        const next = item.upgradeLevel + 1
        const price = craftUpgradeCost(item.template.levelReq, next)
        const cost = price.money
        const professionCode = item.template.craftProfessionCode ?? craftProfessionForItem(item.template.type)
        const owned = await tx.characterProfession.findUnique({ where: { characterId_professionCode: { characterId, professionCode } } })
        const chance = calcUpgradeSuccessChance(item.upgradeLevel, owned?.level ?? 0)
        const required = await resourceAvailability(tx, characterId, price.resources)
        const lacking = required.filter(row => !row.enough)
        if (lacking.length) {
          const what = lacking.map(row => row.resourceName + ' ' + row.available + '/' + row.amount).join(', ')
          throw new AppError(ErrorCode.CONFLICT, 'Не хватает: ' + what, 409)
        }
        for (const row of required) {
          await ResourcesService.consume(tx, { characterId, resourceTemplateId: row.resourceTemplateId!, amount: row.amount, reasonCode: 'UPGRADE_USE', refType: 'upgrade', refId: item.id })
        }
        const newBalance = await EconomyService.debit(tx, { characterId, amount: cost, reasonCode: 'UPGRADE_COST', refType: 'upgrade', refId: item.id })
        const success = rng() < chance
        const gain = BalanceConfig.economy.crafting.upgradePoints
        const before = item.upgradeLevel
        const after = success ? next : before
        if (success) {
          await tx.itemInstance.update({ where: { id: item.id }, data: { upgradeLevel: after, extraPoints: { increment: gain }, freePoints: { increment: gain } } })
        }
        const spent = required.map(row => ({ code: row.resourceCode, amount: row.amount }))
        await tx.upgradeLog.create({ data: { characterId, itemInstanceId: item.id, upgradeType: 'POINTS', levelBefore: before, levelAfter: after, cost, successChance: chance, result: success ? 'SUCCESS' : 'FAILURE', resourcesSpentJson: spent, resultCode: success ? 'SUCCESS' : 'FAIL' } })
        await tx.itemLog.create({ data: { itemId: item.id, characterId, actionCode: success ? 'UPGRADED' : 'UPGRADE_FAILED', details: { upgradeType: 'POINTS', before, after, cost, chance, professionCode, points: success ? gain : 0, resources: spent } } })
        return { itemId: item.id, success, upgradeType: 'POINTS', levelBefore: before, levelAfter: after, cost, chance, profession: { code: professionCode, level: owned?.level ?? 0 }, pointsGain: success ? gain : 0, resourceSpent: spent, newBalance }
      }
      if (!item.template.upgradeAllowed || !isUpgradeCompatible(item.template.type, upgradeType)) throw new AppError(ErrorCode.UPG_NOT_ALLOWED, 'Upgrade unavailable', 400)
      if (item.status === 'BROKEN' || item.status === 'ON_MARKET') throw new AppError(ErrorCode.UPG_ITEM_STATE, 'Item cannot be upgraded', 409)
      if (item.upgradeLevel >= MAX_LEVEL) throw new AppError(ErrorCode.UPG_MAX_LEVEL, 'Maximum upgrade level reached', 400)
      const next = item.upgradeLevel + 1
      const cost = calcUpgradeCost(item.template.priceBase, next)
      const professionCode = item.template.craftProfessionCode ?? craftProfessionForItem(item.template.type)
      // Только читаем: улучшение не должно выдавать профессию даром — она
      // покупается в Училище. Без профессии шанс считается с нулевого уровня.
      const owned = await tx.characterProfession.findUnique({
        where: { characterId_professionCode: { characterId, professionCode } },
      })
      const craft = { level: owned?.level ?? 0 }
      const chance = calcUpgradeSuccessChance(item.upgradeLevel, craft.level)
      const required = requiredUpgradeResource(item.template.type, next)
      const resource = await tx.resourceTemplate.findUniqueOrThrow({ where: { code: required.code } })
      await ResourcesService.consume(tx, { characterId, resourceTemplateId: resource.id, amount: required.amount, reasonCode: 'UPGRADE_USE', refType: 'upgrade', refId: item.id })
      const newBalance = await EconomyService.debit(tx, { characterId, amount: cost, reasonCode: 'UPGRADE_COST', refType: 'upgrade', refId: item.id })
      const success = rng() < chance
      const before = item.upgradeLevel
      let after = before
      if (success) {
        const mods = (item.upgradeModifiersJson as Partial<Record<UpgradeKind, number>> | null) ?? {}
        const nextMods = { ...mods, [upgradeType]: (mods[upgradeType] ?? 0) + 1 }
        const stats = applyUpgradeModifiers(item.template, nextMods, item.statAllocation, item.socketsJson)
        const oldMax = item.durabilityMax
        const nextMax = upgradeType === 'DURABILITY' ? stats.durabilityMax : item.durabilityMax
        const nextCurrent = upgradeType === 'DURABILITY' && oldMax > 0 ? Math.round(item.durabilityCurrent * nextMax / oldMax) : item.durabilityCurrent
        after = next
        await tx.itemInstance.update({ where: { id: item.id }, data: { upgradeLevel: after, upgradeModifiersJson: nextMods, durabilityMax: nextMax, durabilityCurrent: nextCurrent } })
      }
      await tx.upgradeLog.create({ data: { characterId, itemInstanceId: item.id, upgradeType: upgradeType as UpgradeType, levelBefore: before, levelAfter: after, cost, successChance: chance, result: success ? 'SUCCESS' : 'FAILURE', resourcesSpentJson: [required], resultCode: success ? 'SUCCESS' : 'FAIL' } })
      await tx.itemLog.create({ data: { itemId: item.id, characterId, actionCode: success ? 'UPGRADED' : 'UPGRADE_FAILED', details: { upgradeType, before, after, cost, chance, professionCode, professionLevel: craft.level, resource: required } } })
      return { itemId: item.id, success, upgradeType, levelBefore: before, levelAfter: after, cost, chance, profession: { code: professionCode, level: craft.level }, resourceSpent: required, newBalance }
    } })
  },
}
