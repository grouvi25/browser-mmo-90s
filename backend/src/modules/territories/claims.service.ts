// =============================================================
// ЗАЯВКИ НА ТЕРРИТОРИЮ — шаг F2 Этапа 4
//
// Клан подаёт заявку на район, через шесть часов начинается бой, победитель
// получает контроль. Боевой механики этап не вводит: бой идёт на
// существующем командном бою N против N, тот же резолвер, та же сетка.
// Боевое ядро принято заказчиком, и менять его ради войны значит рисковать
// принятой частью игры.
//
// ТЗ: docs/specs/stage-4/MASTER_TZ_STAGE_4_STRATEGY_PREMIUM_WAR.md, раздел 8.
// =============================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { BalanceConfig } from '../../config/balance.config'
import { AuthorityService, AUTHORITY_COSTS } from './authority.service'
import { isProtected } from './territories.formulas'
import type { ClanPermission } from '../clans/clans.formulas'

const T = BalanceConfig.strategy.territory
const HOUR_MS = 3_600_000

/** Заявка занимает район, пока идёт: этих статусов не бывает по два. */
const OPEN_STATUSES = ['PENDING', 'BATTLE'] as const

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

export const ClaimsService = {
  /**
   * Подать заявку на район.
   *
   * Все проверки — до единого списания. Возвращается ПЕРВАЯ непройденная,
   * словами: в стратегическом слое отказ это половина игры, и игрок обязан
   * понимать, чего именно не хватает, не заглядывая в документацию.
   */
  async file(characterId: string, code: string, roster: string[]) {
    return withTransaction(async tx => {
      const member = await memberWithPermission(tx, characterId, 'WAR')
      const clan = member.clan

      const territory = await tx.territory.findUnique({ where: { code } })
      if (!territory) throw new AppError(ErrorCode.TERRITORY_NOT_FOUND, 'Район не найден', 404)

      if (territory.ownerClanId === clan.id) {
        throw new AppError(ErrorCode.WAR_OWN_TERRITORY, 'Район и так ваш', 409)
      }
      if (isProtected(territory.protectedUntil)) {
        throw new AppError(
          ErrorCode.WAR_PROTECTED,
          `Район под защитой до ${territory.protectedUntil!.toISOString()}`,
          409,
        )
      }

      // Союзника не атакуют: иначе дипломатия Этапа 3 не значит ничего.
      if (territory.ownerClanId) {
        const ally = await tx.clanRelation.findFirst({
          where: {
            type: 'ALLIANCE',
            OR: [
              { fromClanId: clan.id, toClanId: territory.ownerClanId },
              { fromClanId: territory.ownerClanId, toClanId: clan.id },
            ],
          },
        })
        if (ally) throw new AppError(ErrorCode.WAR_ALLY_OWNED, 'Район принадлежит союзному клану', 409)
      }

      // Открытая заявка на район уже есть.
      //
      // Раньше этой проверки не было вовсе: WAR_005 держался ИСКЛЮЧИТЕЛЬНО
      // на частичном уникальном индексе, а его Prisma не умеет объявлять в
      // схеме — значит в любой базе, поднятой через `prisma db push`, его
      // нет. В CI база поднимается именно так, и там второй клан спокойно
      // подавал вторую заявку на тот же район. Индекс остаётся, но теперь
      // страхует только гонку, а не заменяет проверку.
      const openClaims = await tx.territoryClaim.count({
        where: { territoryId: territory.id, status: { in: [...OPEN_STATUSES] } },
      })
      if (openClaims > 0) {
        throw new AppError(ErrorCode.WAR_CLAIM_EXISTS, 'На район уже подана заявка', 409)
      }

      const owned = await tx.territory.count({
        where: { ownerClanId: clan.id, status: 'CONTROLLED' },
      })
      if (owned >= clan.territoryLimit) {
        throw new AppError(
          ErrorCode.WAR_TERRITORY_LIMIT,
          `Достигнут предел территорий клана: ${clan.territoryLimit}`,
          409,
        )
      }

      const lastClaim = await tx.territoryClaim.findFirst({
        where: { attackerClanId: clan.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      if (lastClaim) {
        const passedHours = (Date.now() - lastClaim.createdAt.getTime()) / HOUR_MS
        if (passedHours < T.claimClanCooldownHours) {
          const left = Math.ceil(T.claimClanCooldownHours - passedHours)
          throw new AppError(
            ErrorCode.WAR_CLAN_COOLDOWN,
            `Клан подавал заявку недавно, следующая через ${left} ч`,
            409,
          )
        }
      }

      await assertRoster(tx, clan.id, roster)

      // Взнос безвозвратен: возвратный превращает заявку в бесплатную
      // разведку состава обороны.
      if (clan.treasury < T.claimFee) {
        throw AppError.insufficientFunds(clan.treasury, T.claimFee)
      }

      const battleStartsAt = new Date(Date.now() + T.claimWindowHours * HOUR_MS)
      let claim
      try {
        claim = await tx.territoryClaim.create({
          data: {
            territoryId: territory.id,
            attackerClanId: clan.id,
            defenderClanId: territory.ownerClanId,
            filedByCharacterId: characterId,
            battleStartsAt,
            feePaid: T.claimFee,
            authoritySpent: AUTHORITY_COSTS.claim,
          },
        })
      } catch (error) {
        // Частичный уникальный индекс на открытую заявку района ловит гонку:
        // вторая вставка падает здесь, а не на прочитанном ранее состоянии.
        if (isUniqueViolation(error)) {
          throw new AppError(ErrorCode.WAR_CLAIM_EXISTS, 'На район уже подана заявка', 409)
        }
        throw error
      }

      await tx.territoryClaimRoster.createMany({
        data: roster.map(id => ({ claimId: claim.id, characterId: id, side: 1, battleLevel: 0 })),
        skipDuplicates: true,
      })
      await syncRosterLevels(tx, claim.id, roster)

      await AuthorityService.spend(tx, {
        clanId: clan.id, amount: AUTHORITY_COSTS.claim,
        reason: 'CLAIM_FILED', refId: claim.id,
      })

      const updatedClan = await tx.clan.update({
        where: { id: clan.id },
        data: { treasury: { decrement: T.claimFee } },
      })
      await tx.clanTreasuryLog.create({
        data: {
          clanId: clan.id, characterId, amount: -T.claimFee,
          balanceAfter: updatedClan.treasury, reason: 'TERRITORY_CLAIM_FEE',
        },
      })

      await tx.territory.update({ where: { id: territory.id }, data: { status: 'CONTESTED' } })

      return {
        claimId: claim.id,
        status: claim.status,
        battleStartsAt,
        feePaid: T.claimFee,
        authoritySpent: AUTHORITY_COSTS.claim,
      }
    })
  },

  /**
   * Выставить состав обороны.
   *
   * Закрывается за десять минут до боя: иначе обороняющийся подменяет состав
   * в последнюю секунду, увидев, кого привёл атакующий.
   */
  async setDefence(characterId: string, claimId: string, roster: string[]) {
    return withTransaction(async tx => {
      const member = await memberWithPermission(tx, characterId, 'WAR')
      const claim = await tx.territoryClaim.findUnique({ where: { id: claimId } })
      if (!claim) throw new AppError(ErrorCode.WAR_CLAIM_NOT_FOUND, 'Заявка не найдена', 404)
      if (claim.defenderClanId !== member.clanId) {
        throw new AppError(ErrorCode.WAR_NOT_DEFENDER, 'Район не принадлежит вашему клану', 403)
      }
      if (claim.status !== 'PENDING') {
        throw new AppError(ErrorCode.WAR_BATTLE_STARTED, 'Бой уже начался', 409)
      }
      const minutesLeft = (claim.battleStartsAt.getTime() - Date.now()) / 60_000
      if (minutesLeft < T.defenceLockMinutes) {
        throw new AppError(ErrorCode.WAR_DEFENCE_LOCKED, 'До боя меньше десяти минут, состав закрыт', 409)
      }

      await assertRoster(tx, member.clanId, roster, { min: 1 })
      await tx.territoryClaimRoster.deleteMany({ where: { claimId, side: 2 } })
      await tx.territoryClaimRoster.createMany({
        data: roster.map(id => ({ claimId, characterId: id, side: 2, battleLevel: 0 })),
        skipDuplicates: true,
      })
      await syncRosterLevels(tx, claimId, roster)
      return { claimId, roster: roster.length }
    })
  },

  /** Отозвать заявку. Взнос не возвращается, авторитет — да. */
  async cancel(characterId: string, claimId: string) {
    return withTransaction(async tx => {
      const member = await memberWithPermission(tx, characterId, 'WAR')
      const claim = await tx.territoryClaim.findUnique({ where: { id: claimId } })
      if (!claim) throw new AppError(ErrorCode.WAR_CLAIM_NOT_FOUND, 'Заявка не найдена', 404)
      if (claim.attackerClanId !== member.clanId) {
        throw new AppError(ErrorCode.WAR_NO_PERMISSION, 'Заявка не вашего клана', 403)
      }
      if (claim.status !== 'PENDING') {
        throw new AppError(ErrorCode.WAR_BATTLE_STARTED, 'Бой уже начался', 409)
      }
      await tx.territoryClaim.update({
        where: { id: claimId },
        data: { status: 'CANCELLED', resolvedAt: new Date() },
      })
      await releaseTerritory(tx, claim.territoryId)
      // Авторитет возвращается, деньги нет: авторитет тратится на намерение,
      // а взнос — плата за то, что оборона уже потратила время на сбор.
      await AuthorityService.grant(tx, {
        clanId: claim.attackerClanId, amount: claim.authoritySpent,
        reason: 'CLAIM_REFUNDED', refId: claim.id,
      })
      return { claimId, status: 'CANCELLED' as const, feeRefunded: false }
    })
  },

  /** Карточка заявки: обе стороны видят состав друг друга с момента подачи. */
  async get(claimId: string) {
    const claim = await prisma.territoryClaim.findUnique({
      where: { id: claimId },
      include: {
        territory: { select: { code: true, name: true } },
        attackerClan: { select: { tag: true, name: true } },
        defenderClan: { select: { tag: true, name: true } },
        roster: {
          include: { character: { select: { nickname: true } } },
          orderBy: { battleLevel: 'desc' },
        },
      },
    })
    if (!claim) throw new AppError(ErrorCode.WAR_CLAIM_NOT_FOUND, 'Заявка не найдена', 404)
    const side = (n: number) => claim.roster
      .filter(row => row.side === n)
      .map(row => ({ nickname: row.character.nickname, battleLevel: row.battleLevel }))
    return {
      id: claim.id,
      territory: claim.territory,
      status: claim.status,
      battleStartsAt: claim.battleStartsAt,
      battleId: claim.battleId,
      walkover: claim.walkover,
      // Состав атакующего виден обороне с самого начала. Внезапное нападение
      // в асинхронной игре означает, что побеждает оказавшийся онлайн, а не
      // тот, кто лучше играет.
      attacker: { clanTag: claim.attackerClan.tag, name: claim.attackerClan.name, roster: side(1) },
      defender: claim.defenderClan
        ? { clanTag: claim.defenderClan.tag, name: claim.defenderClan.name, roster: side(2) }
        : null,
    }
  },

  /** Журнал войн клана. */
  async listForClan(clanId: string, limit = 20) {
    const claims = await prisma.territoryClaim.findMany({
      where: { OR: [{ attackerClanId: clanId }, { defenderClanId: clanId }] },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { territory: { select: { code: true, name: true } } },
    })
    return {
      items: claims.map(claim => ({
        id: claim.id,
        at: claim.createdAt,
        territoryCode: claim.territory.code,
        territoryName: claim.territory.name,
        role: claim.attackerClanId === clanId ? ('ATTACK' as const) : ('DEFENCE' as const),
        status: claim.status,
        battleId: claim.battleId,
        walkover: claim.walkover,
      })),
    }
  },
}

// ── вспомогательное ────────────────────────────────────────────

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: string }).code === 'P2002'
}

/**
 * Состав: нужное число бойцов, все из клана, все не ниже порога.
 *
 * Порог и число — защита от армии альтов: без них заявку закрывают пятью
 * персонажами первого уровня, созданными за минуту.
 */
async function assertRoster(
  tx: Prisma.TransactionClient,
  clanId: string,
  roster: string[],
  options: { min?: number } = {},
) {
  const min = options.min ?? T.claimMinRoster
  const unique = [...new Set(roster)]
  if (unique.length < min) {
    throw new AppError(
      ErrorCode.WAR_ROSTER_TOO_SMALL,
      `В составе нужно не меньше ${min} бойцов`,
      400,
    )
  }
  // ClanMember.characterId — свободный ключ: связи с Character в схеме нет,
  // поэтому членство и самих персонажей берём двумя запросами.
  const members = await tx.clanMember.findMany({
    where: { characterId: { in: unique }, clanId, status: 'ACTIVE' },
    select: { characterId: true },
  })
  const inClan = new Set(members.map(m => m.characterId))
  const characters = await tx.character.findMany({
    where: { id: { in: unique } },
    select: { id: true, nickname: true, battleLevel: true },
  })
  const byId = new Map(characters.map(c => [c.id, c]))
  for (const id of unique) {
    const character = inClan.has(id) ? byId.get(id) : undefined
    if (!character) {
      throw new AppError(ErrorCode.WAR_FIGHTER_NOT_IN_CLAN, 'Боец не состоит в вашем клане', 400)
    }
    if (character.battleLevel < T.claimMinBattleLevel) {
      throw new AppError(
        ErrorCode.WAR_FIGHTER_TOO_WEAK,
        `Боец ниже ${T.claimMinBattleLevel} уровня: ${character.nickname}`,
        400,
      )
    }
  }
}

/** Записать вес бойцов на момент подачи — состав нельзя подменить потом. */
async function syncRosterLevels(tx: Prisma.TransactionClient, claimId: string, roster: string[]) {
  const characters = await tx.character.findMany({
    where: { id: { in: [...new Set(roster)] } },
    select: { id: true, battleLevel: true },
  })
  for (const character of characters) {
    await tx.territoryClaimRoster.updateMany({
      where: { claimId, characterId: character.id },
      data: { battleLevel: character.battleLevel },
    })
  }
}

/** Вернуть району статус по факту владения после закрытия заявки. */
export async function releaseTerritory(tx: Prisma.TransactionClient, territoryId: string) {
  const territory = await tx.territory.findUniqueOrThrow({ where: { id: territoryId } })
  const stillOpen = await tx.territoryClaim.count({
    where: { territoryId, status: { in: [...OPEN_STATUSES] } },
  })
  if (stillOpen > 0) return
  await tx.territory.update({
    where: { id: territoryId },
    data: { status: territory.ownerClanId ? 'CONTROLLED' : 'NEUTRAL' },
  })
}

/**
 * Можно ли клану подать заявку на район — и если нет, то почему.
 *
 * Тот же набор проверок, что и в ClaimsService.file, но без побочных
 * действий: список районов должен показывать ровно ту причину, по которой
 * откажет мутация. Две независимые копии разошлись бы, и кнопка врала бы
 * игроку — ровно эта ошибка уже случилась с налётами на объекты.
 */
export type ClaimBlockedReason =
  | 'NO_CLAN' | 'NO_PERMISSION' | 'PROTECTED' | 'CONTESTED' | 'LIMIT_REACHED'
  | 'NOT_ENOUGH_AUTHORITY' | 'NOT_ENOUGH_MONEY' | 'CLAN_COOLDOWN' | 'ALLY_OWNED'
  | 'OWN_TERRITORY'

export async function claimEligibility(characterId: string): Promise<{
  clanId: string | null
  check: (territory: {
    code: string
    ownerClanId: string | null
    protectedUntil: Date | null
    status: string
  }) => ClaimBlockedReason | null
}> {
  const member = await prisma.clanMember.findUnique({
    where: { characterId },
    include: { role: true, clan: true },
  })
  if (!member || member.status !== 'ACTIVE') {
    return { clanId: null, check: () => 'NO_CLAN' }
  }
  const permissions = Array.isArray(member.role.permissions)
    ? member.role.permissions.filter((v): v is string => typeof v === 'string')
    : []
  if (!permissions.includes('WAR')) {
    return { clanId: member.clanId, check: () => 'NO_PERMISSION' }
  }

  const clan = member.clan
  const [owned, lastClaim, allies, pending] = await Promise.all([
    prisma.territory.count({ where: { ownerClanId: clan.id, status: 'CONTROLLED' } }),
    prisma.territoryClaim.findFirst({
      where: { attackerClanId: clan.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.clanRelation.findMany({
      where: {
        type: 'ALLIANCE',
        OR: [{ fromClanId: clan.id }, { toClanId: clan.id }],
      },
    }),
    prisma.territoryClaim.findMany({
      where: { status: { in: ['PENDING', 'BATTLE'] } },
      include: { territory: { select: { code: true } } },
    }),
  ])
  const allyIds = new Set(allies.map(r => (r.fromClanId === clan.id ? r.toClanId : r.fromClanId)))
  const contested = new Set(pending.map(c => c.territory.code))
  const cooldownLeft = lastClaim
    ? T.claimClanCooldownHours - (Date.now() - lastClaim.createdAt.getTime()) / HOUR_MS
    : 0

  return {
    clanId: clan.id,
    check: territory => {
      if (territory.ownerClanId === clan.id) return 'OWN_TERRITORY'
      if (isProtected(territory.protectedUntil)) return 'PROTECTED'
      if (contested.has(territory.code)) return 'CONTESTED'
      if (territory.ownerClanId && allyIds.has(territory.ownerClanId)) return 'ALLY_OWNED'
      if (owned >= clan.territoryLimit) return 'LIMIT_REACHED'
      if (cooldownLeft > 0) return 'CLAN_COOLDOWN'
      if (clan.authority < AUTHORITY_COSTS.claim) return 'NOT_ENOUGH_AUTHORITY'
      if (clan.treasury < T.claimFee) return 'NOT_ENOUGH_MONEY'
      return null
    },
  }
}
