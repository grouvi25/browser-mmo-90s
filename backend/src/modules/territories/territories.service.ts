// =============================================================
// ТЕРРИТОРИИ — шаг F1 Этапа 4
//
// Район города как объект владения кланом: чтение карты, карточка района
// и активные бонусы клана. Заявки и бои за территорию — шаг F2, здесь их
// намеренно нет: сущности и содержание должны работать и быть проверены
// раньше, чем на них встанет война.
//
// ТЗ: docs/specs/stage-4/MASTER_TZ_STAGE_4_STRATEGY_PREMIUM_WAR.md, часть II.
// =============================================================
import type { TerritoryClaimStatus } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { claimEligibility } from './claims.service'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import {
  assignTiers, bonusText, isBonusSuspended, isProtected,
  territoryUpkeepPerDay, TERRITORY_LIMIT, type TerritoryBonusCode,
} from './territories.formulas'

/** Активные бонусы клана: код бонуса -> величина. */
export type TerritoryBonuses = Partial<Record<TerritoryBonusCode, number>>

/** Чем кончилась заявка — словами, от лица района, а не кодом статуса.
    Описаны только решённые: PENDING и BATTLE в историю не попадают —
    это настоящее района, а не его прошлое. */
const CLAIM_EVENT_TEXT: Partial<Record<TerritoryClaimStatus, string>> = {
  WON: 'Район захвачен',
  LOST: 'Атака отбита',
  CANCELLED: 'Заявка отозвана',
  EXPIRED: 'Заявка сорвалась',
}

async function clanIdOf(characterId: string): Promise<string | null> {
  const member = await prisma.clanMember.findUnique({
    where: { characterId },
    select: { clanId: true, status: true },
  })
  return member && member.status === 'ACTIVE' ? member.clanId : null
}

export const TerritoriesService = {
  /**
   * Активные бонусы клана.
   *
   * Отключённые долгом территории не считаются: бонус гаснет раньше, чем
   * район теряется, — клан обязан увидеть проблему до того, как потеряет
   * вложенное. Это единственная точка, через которую бонусы попадают в
   * остальные модули; считать их где-то ещё нельзя.
   */
  async bonusesForClan(clanId: string | null): Promise<TerritoryBonuses> {
    if (!clanId) return {}
    const owned = await prisma.territory.findMany({
      where: { ownerClanId: clanId, status: 'CONTROLLED' },
      select: { bonusCode: true, bonusValue: true, upkeepDebt: true },
    })
    const out: TerritoryBonuses = {}
    for (const territory of owned) {
      if (isBonusSuspended(territory.upkeepDebt)) continue
      out[territory.bonusCode as TerritoryBonusCode] = territory.bonusValue
    }
    return out
  },

  /** То же для персонажа: он получает бонусы своего клана. */
  async bonusesForCharacter(characterId: string): Promise<TerritoryBonuses> {
    return this.bonusesForClan(await clanIdOf(characterId))
  },

  /** Карта районов. Доступна всем: кто чем владеет — публичная информация. */
  async list(characterId: string) {
    const [territories, counts, myClanId] = await Promise.all([
      prisma.territory.findMany({
        orderBy: { code: 'asc' },
        include: { ownerClan: { select: { id: true, name: true, tag: true } } },
      }),
      prisma.productionObject.groupBy({
        by: ['locationId'],
        where: { locationId: { not: null }, isActive: true },
        _count: { _all: true },
      }),
      clanIdOf(characterId),
    ])
    // Право на заявку считает СЕРВЕР по тому же предикату, что и сама
    // заявка: проверок восемь, и клиент не должен повторять ни одну.
    const eligibility = await claimEligibility(characterId)
    const activeClaims = await prisma.territoryClaim.findMany({
      where: { status: { in: ['PENDING', 'BATTLE'] } },
      include: {
        territory: { select: { code: true } },
        attackerClan: { select: { tag: true } },
      },
    })
    const claimByCode = new Map(activeClaims.map(claim => [claim.territory.code, claim]))
    const byDistrict = new Map(counts.map(row => [row.locationId, row._count._all]))
    return {
      items: territories.map(territory => ({
        code: territory.code,
        name: territory.name,
        status: territory.status,
        owner: territory.ownerClan
          ? { clanId: territory.ownerClan.id, name: territory.ownerClan.name, tag: territory.ownerClan.tag }
          : null,
        isMine: !!myClanId && territory.ownerClanId === myClanId,
        bonus: {
          code: territory.bonusCode,
          value: territory.bonusValue,
          text: bonusText(territory.bonusCode, territory.bonusValue),
          // Гасший бонус видно всем: район под долгом — уже не полноценный.
          suspended: isBonusSuspended(territory.upkeepDebt),
        },
        objectCount: byDistrict.get(territory.code) ?? 0,
        protectedUntil: isProtected(territory.protectedUntil) ? territory.protectedUntil : null,
        // Обороняющийся видит заявку и состав атакующего с момента подачи:
        // внезапное нападение в асинхронной игре выигрывает тот, кто просто
        // оказался онлайн, а не тот, кто лучше играет.
        activeClaim: (() => {
          const claim = claimByCode.get(territory.code)
          return claim
            ? { id: claim.id, attackerTag: claim.attackerClan.tag, battleStartsAt: claim.battleStartsAt }
            : null
        })(),
        myClan: (() => {
          const blockedReason = eligibility.check(territory)
          return { canClaim: blockedReason === null, blockedReason }
        })(),
      })),
      limit: TERRITORY_LIMIT,
    }
  },

  /**
   * Карточка района.
   *
   * Содержание и долг показываются только участникам клана-владельца: чужой
   * долг — не публичная информация, иначе он превращается в сигнал
   * «пора нападать».
   */
  async get(code: string, characterId: string) {
    const territory = await prisma.territory.findUnique({
      where: { code },
      include: { ownerClan: { select: { id: true, name: true, tag: true } } },
    })
    if (!territory) throw new AppError(ErrorCode.TERRITORY_NOT_FOUND, 'Territory not found', 404)

    const myClanId = await clanIdOf(characterId)
    const mine = !!myClanId && territory.ownerClanId === myClanId

    const objects = await prisma.productionObject.findMany({
      where: { locationId: code, isActive: true },
      select: { id: true, name: true, type: true, status: true, ownerType: true, ownerClanId: true },
      orderBy: { name: 'asc' },
    })
    // ProductionObject.ownerClanId — свободный ключ: связи с Clan в схеме нет,
    // поэтому метки кланов достаём отдельным запросом, а не include.
    const ownerClanIds = [...new Set(objects.map(o => o.ownerClanId).filter((v): v is string => !!v))]
    const clanTags = ownerClanIds.length
      ? new Map((await prisma.clan.findMany({
          where: { id: { in: ownerClanIds } }, select: { id: true, tag: true },
        })).map(clan => [clan.id, clan.tag]))
      : new Map<string, string>()

    // История района: чем кончались заявки на него. Раздел «Последние
    // события» на карточке ждал это поле с самого начала, но ручка его
    // не отдавала — фронт падал на data.history.length и уносил с собой
    // всю карточку. Берём только решённые заявки: PENDING и BATTLE — это
    // не событие прошлого, они уже показаны отдельной строкой карточки.
    const claims = await prisma.territoryClaim.findMany({
      where: { territoryId: territory.id, status: { in: ['WON', 'LOST', 'CANCELLED', 'EXPIRED'] } },
      select: {
        status: true, walkover: true, createdAt: true, resolvedAt: true,
        attackerClan: { select: { tag: true } },
      },
      orderBy: [{ resolvedAt: 'desc' }, { createdAt: 'desc' }],
      take: 10,
    })
    const history = claims.map(claim => ({
      at: (claim.resolvedAt ?? claim.createdAt).toISOString(),
      event: (CLAIM_EVENT_TEXT[claim.status] ?? 'Заявка закрыта') + (claim.walkover ? ' без боя' : ''),
      clanTag: claim.attackerClan.tag,
    }))

    let upkeep: { tier: number; perDay: number; debt: number; bonusSuspended: boolean } | null = null
    if (mine && territory.ownerClanId) {
      const owned = await prisma.territory.findMany({
        where: { ownerClanId: territory.ownerClanId, status: 'CONTROLLED' },
        select: { id: true, controlledAt: true },
      })
      const tier = assignTiers(owned).get(territory.id) ?? 1
      upkeep = {
        tier,
        perDay: territoryUpkeepPerDay(tier),
        debt: territory.upkeepDebt,
        bonusSuspended: isBonusSuspended(territory.upkeepDebt),
      }
    }

    return {
      code: territory.code,
      name: territory.name,
      status: territory.status,
      owner: territory.ownerClan
        ? { clanId: territory.ownerClan.id, name: territory.ownerClan.name, tag: territory.ownerClan.tag }
        : null,
      isMine: mine,
      bonus: {
        code: territory.bonusCode,
        value: territory.bonusValue,
        text: bonusText(territory.bonusCode, territory.bonusValue),
        suspended: isBonusSuspended(territory.upkeepDebt),
      },
      protectedUntil: isProtected(territory.protectedUntil) ? territory.protectedUntil : null,
      controlledAt: territory.controlledAt,
      upkeep,
      objects: objects.map(object => ({
        id: object.id,
        name: object.name,
        type: object.type,
        status: object.status,
        ownerTag: object.ownerType === 'CLAN' && object.ownerClanId
          ? clanTags.get(object.ownerClanId) ?? null : null,
      })),
      history,
    }
  },

  /** Территории клана со сводкой по содержанию. Только для участников. */
  async listForClan(clanId: string, characterId: string) {
    const myClanId = await clanIdOf(characterId)
    if (myClanId !== clanId) throw new AppError(ErrorCode.CLAN_PERMISSION, 'Not a clan member', 403)

    const owned = await prisma.territory.findMany({
      where: { ownerClanId: clanId, status: 'CONTROLLED' },
      select: {
        id: true, code: true, name: true, bonusCode: true, bonusValue: true,
        upkeepDebt: true, controlledAt: true,
      },
    })
    const tiers = assignTiers(owned)
    const items = owned.map(territory => {
      const tier = tiers.get(territory.id) ?? 1
      return {
        code: territory.code,
        name: territory.name,
        bonus: {
          code: territory.bonusCode,
          value: territory.bonusValue,
          text: bonusText(territory.bonusCode, territory.bonusValue),
          suspended: isBonusSuspended(territory.upkeepDebt),
        },
        tier,
        upkeepPerDay: territoryUpkeepPerDay(tier),
        debt: territory.upkeepDebt,
        controlledAt: territory.controlledAt,
      }
    })
    return {
      items,
      limit: TERRITORY_LIMIT,
      upkeepPerDay: items.reduce((sum, item) => sum + item.upkeepPerDay, 0),
      totalDebt: items.reduce((sum, item) => sum + item.debt, 0),
    }
  },
}
