// =============================================================
// АДМИНКА: РАЗДЕЛЫ СТРАТЕГИЧЕСКОГО СЛОЯ — шаг G1 Этапа 5
//
// Кланы, территории, заявки, налёты, подписка и помощники. Всё, что Этап 4
// построил для игрока и не показал администратору.
//
// Здесь только ЧТЕНИЕ. Мутации этих разделов приходят шагом G2 вместе с
// журналом админских действий: по принципу П1 действие, у которого нет
// записанной обратной операции, админу не выдаётся, а журнала пока нет.
// Выдать сейчас «сброс района», а обратимость приделать потом — значит
// оставить между шагами окно, в котором админ ломает состояние безвозвратно.
//
// ТЗ: docs/specs/stage-5/STAGE5_ADMIN_API.md, разделы 4.1–4.4.
// =============================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { AuthorityService } from '../territories/authority.service'
import { clanUpkeepPreview } from '../../workers/clan-maintenance.worker'
import { isBonusSuspended, isProtected } from '../territories/territories.formulas'

/** Сколько строк отдаём за раз, если админ не попросил иначе. */
const PAGE = 25
const LOG_PAGE = 50

function page(limit?: number, max = 200) {
  return Math.min(Math.max(1, limit ?? PAGE), max)
}

export const AdminStrategyService = {
  // ── Кланы ─────────────────────────────────────────────────

  /**
   * Список бригад. Курсор по id, а не по номеру страницы: список меняется
   * под руками — кто-то распускает клан, кто-то создаёт, — и нумерация
   * страниц на живых данных пропускает строки.
   */
  async clans(params: { query?: string; cursor?: string; limit?: number }) {
    const take = page(params.limit)
    const where = params.query
      ? {
        OR: [
          { name: { contains: params.query, mode: 'insensitive' as const } },
          { tag: { contains: params.query, mode: 'insensitive' as const } },
        ],
      }
      : {}

    const rows = await prisma.clan.findMany({
      where,
      take: take + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, tag: true, level: true, treasury: true,
        authority: true, territoryLimit: true, maintenanceDebt: true,
        isFrozen: true, lastChargedAt: true, createdAt: true,
        _count: { select: { members: true, territories: true } },
      },
    })

    const items = rows.slice(0, take).map(clan => ({
      id: clan.id,
      name: clan.name,
      tag: clan.tag,
      level: clan.level,
      treasury: clan.treasury,
      authority: clan.authority,
      territories: clan._count.territories,
      territoryLimit: clan.territoryLimit,
      members: clan._count.members,
      maintenanceDebt: clan.maintenanceDebt,
      isFrozen: clan.isFrozen,
      lastChargedAt: clan.lastChargedAt,
      createdAt: clan.createdAt,
    }))
    return { items, nextCursor: rows.length > take ? rows[take - 1].id : null }
  },

  /**
   * Карточка бригады: состав, склад, оба журнала, территории и сверка
   * авторитета.
   *
   * Сверка идёт прямо в карточке, а не отдельной ручкой: расхождение поля с
   * журналом — это либо дефект, либо правка мимо приложения, и админ должен
   * увидеть его тогда же, когда смотрит на клан, а не когда специально
   * пойдёт проверять.
   */
  async clanCard(clanId: string) {
    const clan = await prisma.clan.findUnique({
      where: { id: clanId },
      include: {
        // У ClanMember нет связи с персонажем: связь по characterId без
        // внешнего ключа. Ники добираем отдельным запросом ниже.
        members: {
          include: { role: { select: { code: true, name: true, permissions: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        storage: { orderBy: { resourceCode: 'asc' } },
        territories: {
          select: {
            code: true, name: true, status: true, upkeepTier: true,
            upkeepDebt: true, controlledAt: true, protectedUntil: true,
          },
          orderBy: { controlledAt: 'asc' },
        },
      },
    })
    if (!clan) throw AppError.notFound('Clan', clanId)

    const characters = await prisma.character.findMany({
      where: { id: { in: clan.members.map(member => member.characterId) } },
      select: { id: true, nickname: true, battleLevel: true, status: true },
    })
    const byId = new Map(characters.map(character => [character.id, character]))

    const [treasuryLog, authorityLog, audit, upkeepPerDay, claims, attacks] = await Promise.all([
      prisma.clanTreasuryLog.findMany({
        where: { clanId }, take: LOG_PAGE, orderBy: { createdAt: 'desc' },
      }),
      prisma.clanAuthorityLog.findMany({
        where: { clanId }, take: LOG_PAGE, orderBy: { createdAt: 'desc' },
      }),
      AuthorityService.audit(clanId),
      clanUpkeepPreview(clanId),
      prisma.territoryClaim.count({
        where: {
          status: { in: ['PENDING', 'BATTLE'] },
          OR: [{ attackerClanId: clanId }, { defenderClanId: clanId }],
        },
      }),
      prisma.objectAttack.count({ where: { attackerClanId: clanId } }),
    ])

    return {
      clan: {
        id: clan.id, name: clan.name, tag: clan.tag, level: clan.level,
        treasury: clan.treasury, authority: clan.authority,
        territoryLimit: clan.territoryLimit, maintenanceDebt: clan.maintenanceDebt,
        isFrozen: clan.isFrozen, lastChargedAt: clan.lastChargedAt,
        upkeepPerDay,
      },
      // Сверка поля с журналом. matches === false означает, что цифру
      // правили мимо приложения либо где-то потерялась строка журнала.
      authorityAudit: audit,
      members: clan.members.map(member => ({
        characterId: member.characterId,
        nickname: byId.get(member.characterId)?.nickname ?? null,
        battleLevel: byId.get(member.characterId)?.battleLevel ?? null,
        characterStatus: byId.get(member.characterId)?.status ?? null,
        role: member.role.code,
        roleName: member.role.name,
        status: member.status,
        joinedAt: member.joinedAt,
      })),
      storage: clan.storage.map(row => ({ resourceCode: row.resourceCode, amount: row.amount })),
      territories: clan.territories.map(row => ({
        ...row,
        bonusSuspended: isBonusSuspended(row.upkeepDebt),
        isProtected: isProtected(row.protectedUntil),
      })),
      treasuryLog,
      authorityLog,
      openClaims: claims,
      attacksMade: attacks,
    }
  },

  // ── Территории ────────────────────────────────────────────

  /** Карта глазами администратора: владелец, долг, защита, открытая заявка. */
  async territories() {
    const rows = await prisma.territory.findMany({
      orderBy: { code: 'asc' },
      include: {
        ownerClan: { select: { id: true, name: true, tag: true } },
        claims: {
          where: { status: { in: ['PENDING', 'BATTLE'] } },
          include: {
            attackerClan: { select: { tag: true } },
            defenderClan: { select: { tag: true } },
          },
          take: 1,
        },
      },
    })

    return {
      items: rows.map(row => {
        const claim = row.claims[0]
        return {
          code: row.code,
          name: row.name,
          status: row.status,
          owner: row.ownerClan
            ? { clanId: row.ownerClan.id, name: row.ownerClan.name, tag: row.ownerClan.tag }
            : null,
          bonus: { code: row.bonusCode, value: row.bonusValue },
          upkeepTier: row.upkeepTier,
          upkeepDebt: row.upkeepDebt,
          bonusSuspended: isBonusSuspended(row.upkeepDebt),
          controlledAt: row.controlledAt,
          protectedUntil: row.protectedUntil,
          isProtected: isProtected(row.protectedUntil),
          activeClaim: claim
            ? {
              id: claim.id,
              status: claim.status,
              attackerTag: claim.attackerClan.tag,
              defenderTag: claim.defenderClan?.tag ?? null,
              battleStartsAt: claim.battleStartsAt,
              battleId: claim.battleId,
            }
            : null,
        }
      }),
    }
  },

  // ── Заявки и войны ────────────────────────────────────────

  /**
   * Заявки. По умолчанию только открытые: закрытых со временем станут
   * тысячи, и список «всё подряд» перестанет быть полезен на второй месяц.
   */
  async claims(params: { status?: 'open' | 'all'; cursor?: string; limit?: number }) {
    const take = page(params.limit)
    const where: Prisma.TerritoryClaimWhereInput = params.status === 'all'
      ? {}
      : { status: { in: ['PENDING', 'BATTLE'] } }

    const rows = await prisma.territoryClaim.findMany({
      where,
      take: take + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        territory: { select: { code: true, name: true } },
        attackerClan: { select: { tag: true, name: true } },
        defenderClan: { select: { tag: true, name: true } },
        roster: { select: { side: true } },
      },
    })

    const items = rows.slice(0, take).map(claim => ({
      id: claim.id,
      territory: { code: claim.territory.code, name: claim.territory.name },
      status: claim.status,
      attacker: { tag: claim.attackerClan.tag, name: claim.attackerClan.name },
      defender: claim.defenderClan
        ? { tag: claim.defenderClan.tag, name: claim.defenderClan.name }
        : null,
      battleStartsAt: claim.battleStartsAt,
      battleId: claim.battleId,
      walkover: claim.walkover,
      feePaid: claim.feePaid,
      authoritySpent: claim.authoritySpent,
      roster: {
        attack: claim.roster.filter(row => row.side === 1).length,
        defence: claim.roster.filter(row => row.side === 2).length,
      },
      createdAt: claim.createdAt,
      resolvedAt: claim.resolvedAt,
    }))
    return { items, nextCursor: rows.length > take ? rows[take - 1].id : null }
  },

  /** Состав заявки поимённо — для разбора жалобы «нас было не пятеро». */
  async claimRoster(claimId: string) {
    const claim = await prisma.territoryClaim.findUnique({
      where: { id: claimId },
      include: {
        roster: {
          include: { character: { select: { id: true, nickname: true, battleLevel: true } } },
          orderBy: [{ side: 'asc' }, { createdAt: 'asc' }],
        },
      },
    })
    if (!claim) throw AppError.notFound('TerritoryClaim', claimId)
    return {
      claimId,
      status: claim.status,
      roster: claim.roster.map(row => ({
        side: row.side,
        characterId: row.characterId,
        nickname: row.character?.nickname ?? null,
        battleLevelAtFiling: row.battleLevel,
        battleLevelNow: row.character?.battleLevel ?? null,
      })),
    }
  },

  // ── Налёты на объекты ─────────────────────────────────────

  /** История атак по объекту плюс остаток отката. */
  async objectAttacks(objectId: string, limit?: number) {
    const object = await prisma.productionObject.findUnique({
      where: { id: objectId },
      select: {
        id: true, code: true, name: true, locationId: true, status: true,
        durabilityCurrent: true, durabilityMax: true, balance: true,
        ownerType: true, ownerClanId: true, ownerCharacterId: true,
      },
    })
    if (!object) throw AppError.notFound('ProductionObject', objectId)

    const items = await prisma.objectAttack.findMany({
      where: { objectId },
      take: page(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        attackerClan: { select: { tag: true } },
        defenderClan: { select: { tag: true } },
      },
    })

    return {
      object,
      items: items.map(row => ({
        at: row.createdAt,
        type: row.type,
        attackerTag: row.attackerClan.tag,
        defenderTag: row.defenderClan?.tag ?? null,
        durabilityLost: row.durabilityLost,
        moneyTaken: row.moneyTaken,
        cancelledCycleId: row.cancelledCycleId,
        authoritySpent: row.authoritySpent,
      })),
    }
  },

  // ── Premium и помощники ───────────────────────────────────

  /** Подписка персонажа: срок, покупки, помощники. */
  async premium(characterId: string) {
    const character = await prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true, nickname: true, isPremium: true, premiumExpiresAt: true },
    })
    if (!character) throw AppError.notFound('Character', characterId)

    const [purchases, helpers] = await Promise.all([
      prisma.premiumPurchase.findMany({
        where: { characterId },
        take: LOG_PAGE,
        orderBy: { createdAt: 'desc' },
        include: { product: { select: { code: true, name: true, kind: true, grantCode: true } } },
      }),
      prisma.helper.findMany({
        where: { characterId },
        orderBy: { createdAt: 'asc' },
        include: {
          activeShift: {
            select: { id: true, productionObjectId: true, endsAt: true, status: true },
          },
        },
      }),
    ])

    return {
      character,
      purchases: purchases.map(row => ({
        at: row.createdAt,
        code: row.product.code,
        name: row.product.name,
        kind: row.product.kind,
        grantCode: row.product.grantCode,
        priceRub: row.priceRub,
        grantedByAdminId: row.grantedByAdminId,
      })),
      helpers: helpers.map(row => ({
        id: row.id,
        name: row.name,
        status: row.status,
        professionCode: row.professionCode,
        professionLevel: row.professionLevel,
        professionExp: row.professionExp,
        activeShift: row.activeShift,
        createdAt: row.createdAt,
      })),
    }
  },

  // ── Единый поиск по журналам ──────────────────────────────

  /**
   * Одна лента вместо шести таблиц.
   *
   * Событие приводится к общей форме: когда, откуда, что произошло, кто,
   * над чем и на сколько. Разнородные журналы читаются вместе именно потому,
   * что нарушение почти никогда не видно в одном из них: перелив денег — это
   * связка «деньги + предметы», кража со склада — «склад + общак».
   *
   * Единого correlationId у журналов Этапов 2–4 нет: он появится вместе с
   * журналом админских действий на шаге G2. До тех пор события сшиваются по
   * ссылке `ref`, которую пишут сами журналы, и врать про correlationId,
   * отдавая всегда null, здесь не станем.
   */
  async logs(params: {
    source?: 'all' | 'currency' | 'item' | 'resource' | 'production' | 'treasury' | 'authority'
    characterId?: string
    clanId?: string
    from?: Date
    to?: Date
    limit?: number
  }) {
    const take = page(params.limit, 500)
    const source = params.source ?? 'all'
    const period = {
      ...(params.from ? { gte: params.from } : {}),
      ...(params.to ? { lte: params.to } : {}),
    }
    const createdAt = Object.keys(period).length > 0 ? { createdAt: period } : {}
    const wants = (name: string) => source === 'all' || source === name

    // Каждый журнал берёт свои take строк, и после слияния лишнее
    // отбрасывается. Иначе один болтливый журнал вытеснил бы остальные.
    const [currency, items, resources, production, treasury, authority] = await Promise.all([
      wants('currency') && !params.clanId
        ? prisma.currencyLog.findMany({
          where: { ...(params.characterId ? { characterId: params.characterId } : {}), ...createdAt },
          take, orderBy: { createdAt: 'desc' },
        })
        : [],
      wants('item') && !params.clanId
        ? prisma.itemLog.findMany({
          where: { ...(params.characterId ? { characterId: params.characterId } : {}), ...createdAt },
          take, orderBy: { createdAt: 'desc' },
        })
        : [],
      wants('resource') && !params.clanId
        ? prisma.resourceLog.findMany({
          where: { ...(params.characterId ? { characterId: params.characterId } : {}), ...createdAt },
          take, orderBy: { createdAt: 'desc' },
        })
        : [],
      wants('production') && !params.clanId
        ? prisma.productionLog.findMany({
          where: { ...(params.characterId ? { characterId: params.characterId } : {}), ...createdAt },
          take, orderBy: { createdAt: 'desc' },
        })
        : [],
      wants('treasury') && !params.characterId
        ? prisma.clanTreasuryLog.findMany({
          where: { ...(params.clanId ? { clanId: params.clanId } : {}), ...createdAt },
          take, orderBy: { createdAt: 'desc' },
        })
        : [],
      wants('authority') && !params.characterId
        ? prisma.clanAuthorityLog.findMany({
          where: { ...(params.clanId ? { clanId: params.clanId } : {}), ...createdAt },
          take, orderBy: { createdAt: 'desc' },
        })
        : [],
    ])

    const events = [
      ...currency.map(row => ({
        at: row.createdAt, source: 'CURRENCY' as const, action: row.reasonCode,
        actor: { type: 'character' as const, id: row.characterId },
        amount: row.amount, balanceAfter: row.balanceAfter,
        ref: row.refId ? { type: row.refType, id: row.refId } : null,
        note: row.note,
      })),
      ...items.map(row => ({
        at: row.createdAt, source: 'ITEM' as const, action: row.actionCode,
        actor: { type: 'character' as const, id: row.characterId },
        amount: null, balanceAfter: null,
        ref: { type: 'item', id: row.itemId },
        note: null,
      })),
      ...resources.map(row => ({
        at: row.createdAt, source: 'RESOURCE' as const, action: row.reasonCode,
        actor: { type: 'character' as const, id: row.characterId },
        amount: row.amountDelta, balanceAfter: row.balanceAfter,
        ref: { type: 'resource', id: row.resourceTemplateId },
        note: null,
      })),
      ...production.map(row => ({
        at: row.createdAt, source: 'PRODUCTION' as const, action: row.eventType,
        actor: row.characterId ? { type: 'character' as const, id: row.characterId } : null,
        amount: null, balanceAfter: null,
        ref: { type: 'object', id: row.productionObjectId },
        note: null,
      })),
      ...treasury.map(row => ({
        at: row.createdAt, source: 'TREASURY' as const, action: row.reason,
        actor: row.characterId ? { type: 'character' as const, id: row.characterId } : null,
        amount: row.amount, balanceAfter: row.balanceAfter,
        ref: { type: 'clan', id: row.clanId },
        note: null,
      })),
      ...authority.map(row => ({
        at: row.createdAt, source: 'AUTHORITY' as const, action: row.reason,
        actor: null,
        amount: row.amount, balanceAfter: row.balanceAfter,
        ref: row.refId ? { type: 'claim-or-attack', id: row.refId } : { type: 'clan', id: row.clanId },
        note: null,
      })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, take)

    return { items: events, sources: source, truncated: events.length === take }
  },
}
