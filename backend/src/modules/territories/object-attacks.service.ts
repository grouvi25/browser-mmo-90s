// =============================================================
// БОИ ЗА ОБЪЕКТЫ — шаг F3 Этапа 4
//
// Две операции и ни одной третьей: диверсия портит объект, ограбление
// снимает долю с его баланса. Разрушить объект нельзя — это принцип П1:
// война двигает экономические потоки, но не стирает прогресс игрока.
// Повреждённый объект чинится восстановительными работами Этапа 3 с
// тройным опытом профессии, то есть война создаёт работу (П2).
//
// ТЗ: docs/specs/stage-4/MASTER_TZ_STAGE_4_STRATEGY_PREMIUM_WAR.md, часть III.
// =============================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { BalanceConfig } from '../../config/balance.config'
import { AuthorityService, AUTHORITY_COSTS } from './authority.service'
import type { ClanPermission } from '../clans/clans.formulas'

const O = BalanceConfig.strategy.objectAttack
const HOUR_MS = 3_600_000

export type AttackBlockedReason =
  | 'NO_CLAN' | 'NO_PERMISSION' | 'COOLDOWN' | 'NOT_AT_WAR'
  | 'OWNER_SOLO' | 'TOO_POOR' | 'NO_AUTHORITY' | 'OWN_OBJECT'

function permissions(role: { permissions: Prisma.JsonValue }): string[] {
  return Array.isArray(role.permissions)
    ? role.permissions.filter((value): value is string => typeof value === 'string')
    : []
}

async function memberWithPermission(
  tx: Prisma.TransactionClient,
  characterId: string,
  permission: ClanPermission,
) {
  const member = await tx.clanMember.findUnique({
    where: { characterId },
    include: { role: true, clan: true },
  })
  if (!member || member.status !== 'ACTIVE') {
    throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Вы не состоите в клане', 404)
  }
  if (!permissions(member.role).includes(permission)) {
    throw new AppError(ErrorCode.WAR_NO_PERMISSION, 'Нет права на военные операции', 403)
  }
  return member
}

/** Владелец объекта как клан: личный объект даёт клан своего хозяина. */
async function ownerClanOf(
  tx: Prisma.TransactionClient,
  object: { ownerType: string; ownerClanId: string | null; ownerCharacterId: string | null },
): Promise<string | null> {
  if (object.ownerType === 'CLAN') return object.ownerClanId
  if (object.ownerType === 'PRIVATE' && object.ownerCharacterId) {
    const member = await tx.clanMember.findUnique({
      where: { characterId: object.ownerCharacterId },
      select: { clanId: true, status: true },
    })
    return member && member.status === 'ACTIVE' ? member.clanId : null
  }
  return null
}

/**
 * Есть ли основание для атаки.
 *
 * Два: объявленная вражда с владельцем — или владелец держит район, на
 * который у нас открыта заявка. Без этого атака превращается в травлю
 * произвольного игрока.
 */
async function hasCasusBelli(
  tx: Prisma.TransactionClient,
  attackerClanId: string,
  defenderClanId: string,
): Promise<boolean> {
  const war = await tx.clanRelation.findFirst({
    where: {
      type: 'HOSTILITY',
      OR: [
        { fromClanId: attackerClanId, toClanId: defenderClanId },
        { fromClanId: defenderClanId, toClanId: attackerClanId },
      ],
    },
  })
  if (war) return true
  const contested = await tx.territoryClaim.count({
    where: {
      attackerClanId,
      defenderClanId,
      status: { in: ['PENDING', 'BATTLE'] },
    },
  })
  return contested > 0
}

/**
 * Районы, в которых клану позволено воевать: свои и те, что держит враг,
 * плюс спорные — на которые у клана открыта заявка.
 *
 * Без этой географии территория не гейтит ничего: атаковать можно было бы
 * любой объект на карте, и захват района переставал бы что-либо значить.
 */
async function warDistricts(
  tx: Prisma.TransactionClient,
  clanId: string,
): Promise<Set<string>> {
  const [mine, contested, enemyOwned, wars] = await Promise.all([
    tx.territory.findMany({
      where: { ownerClanId: clanId, status: 'CONTROLLED' },
      select: { code: true },
    }),
    tx.territoryClaim.findMany({
      where: { attackerClanId: clanId, status: { in: ['PENDING', 'BATTLE'] } },
      include: { territory: { select: { code: true } } },
    }),
    tx.territory.findMany({
      where: { status: 'CONTROLLED', ownerClanId: { not: null }, NOT: { ownerClanId: clanId } },
      select: { code: true, ownerClanId: true },
    }),
    tx.clanRelation.findMany({
      where: { type: 'HOSTILITY', OR: [{ fromClanId: clanId }, { toClanId: clanId }] },
    }),
  ])
  const enemies = new Set(wars.map(w => (w.fromClanId === clanId ? w.toClanId : w.fromClanId)))
  return new Set([
    ...mine.map(t => t.code),
    ...contested.map(c => c.territory.code),
    ...enemyOwned.filter(t => enemies.has(t.ownerClanId!)).map(t => t.code),
  ])
}

/** Общая проверка перед любой атакой. Возвращает объект и клан обороны. */
async function assertAttackable(
  tx: Prisma.TransactionClient,
  characterId: string,
  objectId: string,
) {
  const member = await memberWithPermission(tx, characterId, 'WAR')
  const object = await tx.productionObject.findUnique({ where: { id: objectId } })
  if (!object) throw AppError.notFound('ProductionObject', objectId)

  const defenderClanId = await ownerClanOf(tx, object)
  // Одиночка не корм: хочешь воевать — вступай в клан; не хочешь — тебя
  // не трогают, но и бонусов территории у тебя нет.
  if (!defenderClanId) {
    throw new AppError(ErrorCode.WAR_OWNER_SOLO, 'Владелец объекта не состоит в клане', 409)
  }
  if (defenderClanId === member.clanId) {
    throw new AppError(ErrorCode.WAR_OWN_OBJECT, 'Это объект вашего клана', 409)
  }
  if (!(await hasCasusBelli(tx, member.clanId, defenderClanId))) {
    throw new AppError(
      ErrorCode.WAR_NO_CASUS_BELLI,
      'С владельцем нет вражды и он не держит спорный с вами район',
      409,
    )
  }

  // География войны. Проверяется здесь же, а не только в списке: раньше
  // список говорил «атаковать нечего», а мутация всё равно проходила —
  // объект вне спорных районов можно было ограбить.
  const allowed = await warDistricts(tx, member.clanId)
  if (!object.locationId || !allowed.has(object.locationId)) {
    throw new AppError(
      ErrorCode.WAR_WRONG_DISTRICT,
      'Объект не в вашем районе и не в районе врага',
      409,
    )
  }

  const since = new Date(Date.now() - O.cooldownHours * HOUR_MS)
  const recent = await tx.objectAttack.count({ where: { objectId, createdAt: { gte: since } } })
  if (recent > 0) {
    throw new AppError(
      ErrorCode.WAR_OBJECT_COOLDOWN,
      `Объект атаковали менее ${O.cooldownHours} часов назад`,
      409,
    )
  }

  return { member, object, defenderClanId }
}

export const ObjectAttacksService = {
  /**
   * Диверсия: минус прочность, простой, отмена цикла.
   *
   * Денег не приносит вообще — это чистое отрицание: атакующий тратит
   * ресурс, чтобы враг не производил. Потому и стоит дешевле ограбления.
   */
  async sabotage(characterId: string, objectId: string) {
    return withTransaction(async tx => {
      const { member, object, defenderClanId } = await assertAttackable(tx, characterId, objectId)

      await AuthorityService.spend(tx, {
        clanId: member.clanId, amount: AUTHORITY_COSTS.sabotage,
        reason: 'SABOTAGE_FILED', refId: objectId,
      })

      const durabilityLost = Math.min(object.durabilityCurrent, O.sabotageDurabilityLoss)
      const updated = await tx.productionObject.update({
        where: { id: objectId },
        data: {
          durabilityCurrent: { decrement: durabilityLost },
          status: 'DAMAGED',
        },
      })

      // Активный цикл отменяется, сырьё возвращается на склад объекта.
      // Ущерб — потерянное время, а не материал: труд рабочих уже оплачен,
      // и наказывать войной надо владельца, а не наёмного работника.
      const cycle = await tx.productionCycle.findFirst({
        where: { productionObjectId: objectId, status: { in: ['PENDING', 'RUNNING'] } },
        orderBy: { createdAt: 'asc' },
      })
      let cancelledCycleId: string | null = null
      if (cycle) {
        // Резерв снимается по прямой ссылке на строку склада, а не поиском
        // по коду и качеству: ссылка точна, поиск может задеть соседнюю
        // строку, если у объекта два одинаковых ресурса разного качества.
        const reservations = await tx.cycleInputReservation.findMany({ where: { cycleId: cycle.id } })
        for (const reservation of reservations) {
          await tx.productionObjectInventory.update({
            where: { id: reservation.inventoryId },
            data: { reservedAmount: { decrement: reservation.amount } },
          })
        }
        await tx.productionCycle.update({
          where: { id: cycle.id },
          data: { status: 'FAILED', failureReason: 'OBJECT_DAMAGED', completedAt: new Date() },
        })
        cancelledCycleId = cycle.id
      }

      const attack = await tx.objectAttack.create({
        data: {
          objectId, attackerClanId: member.clanId, defenderClanId,
          filedByCharacterId: characterId, type: 'SABOTAGE',
          durabilityLost, cancelledCycleId,
          authoritySpent: AUTHORITY_COSTS.sabotage,
        },
      })
      await tx.productionLog.create({
        data: {
          productionObjectId: objectId, characterId, eventType: 'SABOTAGED',
          metadataJson: { attackId: attack.id, clanId: member.clanId, durabilityLost, cancelledCycleId },
        },
      })

      return {
        durabilityLost,
        newDurability: updated.durabilityCurrent,
        status: updated.status,
        cancelledCycleId,
        authoritySpent: AUTHORITY_COSTS.sabotage,
      }
    })
  },

  /**
   * Ограбление: доля с баланса объекта в общак атакующего.
   *
   * Склад не трогается. Вынос ресурсов конвертировал бы войну в
   * производство, и воевать стало бы выгоднее, чем работать, — а это
   * обесценивает экономику Этапов 2 и 3.
   */
  async rob(characterId: string, objectId: string) {
    return withTransaction(async tx => {
      const { member, object, defenderClanId } = await assertAttackable(tx, characterId, objectId)

      // Нищего не грабят: иначе механика вырождается в добивание.
      if (object.balance < O.robberyMinBalance) {
        throw new AppError(
          ErrorCode.WAR_OBJECT_TOO_POOR,
          `На балансе объекта меньше ${O.robberyMinBalance} ₽`,
          409,
        )
      }

      await AuthorityService.spend(tx, {
        clanId: member.clanId, amount: AUTHORITY_COSTS.robbery,
        reason: 'ROBBERY_FILED', refId: objectId,
      })

      const moneyTaken = Math.min(Math.floor(object.balance * O.robberyShare), O.robberyCap)
      await tx.productionObject.update({
        where: { id: objectId },
        data: { balance: { decrement: moneyTaken } },
      })
      const clan = await tx.clan.update({
        where: { id: member.clanId },
        data: { treasury: { increment: moneyTaken } },
      })
      await tx.clanTreasuryLog.create({
        data: {
          clanId: member.clanId, characterId, amount: moneyTaken,
          balanceAfter: clan.treasury, reason: 'OBJECT_ROBBERY',
        },
      })

      const attack = await tx.objectAttack.create({
        data: {
          objectId, attackerClanId: member.clanId, defenderClanId,
          filedByCharacterId: characterId, type: 'ROBBERY',
          moneyTaken, authoritySpent: AUTHORITY_COSTS.robbery,
        },
      })
      await tx.productionLog.create({
        data: {
          productionObjectId: objectId, characterId, eventType: 'ROBBED',
          metadataJson: { attackId: attack.id, clanId: member.clanId, moneyTaken },
        },
      })

      return { moneyTaken, treasuryAfter: clan.treasury, authoritySpent: AUTHORITY_COSTS.robbery }
    })
  },

  /**
   * Что можно атаковать.
   *
   * Точный баланс чужого объекта наружу не отдаётся: это разведка, которую
   * не должна давать бесплатная ручка списка. Порог ограбления при этом
   * виден отдельным признаком, и для решения этого достаточно.
   */
  async attackable(characterId: string) {
    const member = await prisma.clanMember.findUnique({
      where: { characterId },
      include: { role: true },
    })
    if (!member || member.status !== 'ACTIVE') return { items: [], blockedReason: 'NO_CLAN' as const }
    const canWar = permissions(member.role).includes('WAR')

    const clan = await prisma.clan.findUniqueOrThrow({
      where: { id: member.clanId },
      select: { authority: true },
    })

    // Тот же расчёт географии, что и в самой атаке: два независимых
    // варианта разошлись бы, и кнопка врала бы игроку.
    const codes = await warDistricts(prisma, member.clanId)
    if (codes.size === 0) return { items: [], blockedReason: 'NOT_AT_WAR' as const }

    const objects = await prisma.productionObject.findMany({
      where: { locationId: { in: [...codes] }, isActive: true },
      select: {
        id: true, name: true, type: true, locationId: true, balance: true,
        ownerType: true, ownerClanId: true, ownerCharacterId: true, status: true,
      },
      orderBy: { name: 'asc' },
    })

    const since = new Date(Date.now() - O.cooldownHours * HOUR_MS)
    const recent = await prisma.objectAttack.findMany({
      where: { objectId: { in: objects.map(o => o.id) }, createdAt: { gte: since } },
      select: { objectId: true, createdAt: true },
    })
    const cooldownUntil = new Map(
      recent.map(row => [row.objectId, new Date(row.createdAt.getTime() + O.cooldownHours * HOUR_MS)]),
    )

    const items = []
    for (const object of objects) {
      const defenderClanId = await ownerClanOf(prisma, object)
      let blockedReason: AttackBlockedReason | null = null
      if (!canWar) blockedReason = 'NO_PERMISSION'
      else if (!defenderClanId) blockedReason = 'OWNER_SOLO'
      else if (defenderClanId === member.clanId) blockedReason = 'OWN_OBJECT'
      else if (cooldownUntil.has(object.id)) blockedReason = 'COOLDOWN'
      else if (!(await hasCasusBelli(prisma, member.clanId, defenderClanId))) blockedReason = 'NOT_AT_WAR'
      else if (clan.authority < AUTHORITY_COSTS.sabotage) blockedReason = 'NO_AUTHORITY'

      const tooPoor = object.balance < O.robberyMinBalance
      items.push({
        objectId: object.id,
        name: object.name,
        type: object.type,
        districtCode: object.locationId,
        status: object.status,
        // Полосой, а не суммой: точный баланс — это разведка.
        balanceBand: object.balance < O.robberyMinBalance ? 'LOW'
          : object.balance < O.robberyCap * 2 ? 'NORMAL' : 'HIGH',
        cooldownUntil: cooldownUntil.get(object.id) ?? null,
        canSabotage: blockedReason === null,
        canRob: blockedReason === null && !tooPoor && clan.authority >= AUTHORITY_COSTS.robbery,
        blockedReason: blockedReason ?? (tooPoor ? ('TOO_POOR' as const) : null),
      })
    }
    return { items }
  },

  /** История атак на объект — владельцу видно, кто и когда приходил. */
  async history(objectId: string, limit = 20) {
    const attacks = await prisma.objectAttack.findMany({
      where: { objectId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { attackerClan: { select: { tag: true, name: true } } },
    })
    return {
      items: attacks.map(attack => ({
        at: attack.createdAt,
        type: attack.type,
        attackerTag: attack.attackerClan.tag,
        durabilityLost: attack.durabilityLost,
        moneyTaken: attack.moneyTaken,
      })),
    }
  },
}
