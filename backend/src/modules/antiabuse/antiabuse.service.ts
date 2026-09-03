// =============================================================
// СИГНАЛЫ АНТИАБУЗА И ГРАФ СВЯЗЕЙ — шаг G3 Этапа 5
//
// Принцип П3: антиабуз не наказывает сам. Он собирает сигналы и показывает
// администратору, а решает человек. Автоматический бан по эвристике на
// закрытом тесте с десятками игроков поймает случайных, а не нарушителей, и
// отпугнёт как раз самых активных.
//
// Каждый сигнал обязан объяснять себя словами и приносить числа, на которых
// сработал: сигнал «подозрительная активность у игрока X» нельзя ни
// проверить, ни отклонить.
//
// ТЗ: docs/specs/stage-5/STAGE5_ANTIABUSE.md разделы 3 и 4.
// =============================================================
import type { AbuseSignalKind, Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { BalanceConfig } from '../../config/balance.config'

const DAY = 24 * 3_600_000

export interface SignalDraft {
  kind: AbuseSignalKind
  severity: 1 | 2 | 3
  userIds: string[]
  summary: string
  evidence: Prisma.InputJsonValue
  /** Ключ повтора: один повод — один сигнал, сколько бы раз ни прогонялся разбор. */
  dedupeKey: string
}

/**
 * Записать сигнал, если такого ещё нет.
 *
 * Разбор гоняется раз в сутки, а поводы живут неделями: без ключа повтора
 * одна и та же пара договорных бойцов давала бы новый сигнал каждое утро, и
 * лента алертов стала бы нечитаемой ровно там, где важна.
 */
export async function raise(draft: SignalDraft): Promise<boolean> {
  const existing = await prisma.abuseSignal.findUnique({
    where: { kind_dedupeKey: { kind: draft.kind, dedupeKey: draft.dedupeKey } },
  })
  if (existing) return false
  await prisma.abuseSignal.create({
    data: {
      kind: draft.kind,
      severity: draft.severity,
      userIds: draft.userIds,
      summary: draft.summary,
      evidence: draft.evidence,
      dedupeKey: draft.dedupeKey,
    },
  })
  return true
}

/** Пара аккаунтов в устойчивом порядке: ребро графа неориентированное. */
function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

const day = (date: Date) => date.toISOString().slice(0, 10)

// ── Граф связей ─────────────────────────────────────────────

/**
 * Пересобрать граф связей аккаунтов.
 *
 * Хранятся рёбра, а не готовые кластеры: правила кластеризации будут
 * меняться, а сырые связи останутся верными.
 *
 * Общий IP сам по себе ничего не значит — за одним адресом сидит семья,
 * общежитие или интернет-кафе, и для игры про 90-е это норма. Ребро по IP
 * весит больше прочих именно потому, что оно только повод посмотреть на
 * пару вместе с потоком ценностей, а не улика.
 */
export async function rebuildAccountGraph(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 30 * DAY)
  const edges = new Map<string, { kind: 'SHARED_IP' | 'MARKET_TRADE' | 'SAME_CLAN'; weight: number; evidence: Prisma.InputJsonValue; at: Date }>()

  const add = (
    a: string, b: string,
    kind: 'SHARED_IP' | 'MARKET_TRADE' | 'SAME_CLAN',
    weight: number,
    evidence: Prisma.InputJsonValue,
    at: Date,
  ) => {
    if (a === b) return
    const [x, y] = pair(a, b)
    const key = `${x}|${y}|${kind}`
    const previous = edges.get(key)
    if (!previous || previous.at < at) edges.set(key, { kind, weight, evidence, at })
  }

  // 1. Общий IP за 30 суток.
  const sessions = await prisma.session.findMany({
    where: { createdAt: { gte: since }, ip: { not: null } },
    select: { userId: true, ip: true, createdAt: true },
    take: 20_000,
  })
  const byIp = new Map<string, Map<string, Date>>()
  for (const row of sessions) {
    const users = byIp.get(row.ip!) ?? new Map<string, Date>()
    const seen = users.get(row.userId)
    if (!seen || seen < row.createdAt) users.set(row.userId, row.createdAt)
    byIp.set(row.ip!, users)
  }
  for (const [ip, users] of byIp) {
    const ids = [...users.keys()]
    // Полный перебор пар безопасен: за одним IP редко больше десятка
    // аккаунтов, а тысяча аккаунтов на адресе — это уже не связь, а прокси.
    if (ids.length < 2 || ids.length > 25) continue
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const at = new Date(Math.max(users.get(ids[i])!.getTime(), users.get(ids[j])!.getTime()))
        add(ids[i], ids[j], 'SHARED_IP', 3, { ip, accounts: ids.length }, at)
      }
    }
  }

  // 2. Сделки на рынке.
  const trades = await prisma.marketListing.findMany({
    where: { status: 'SOLD', soldAt: { gte: since }, buyerCharacterId: { not: null } },
    select: { sellerCharacterId: true, buyerCharacterId: true, price: true, soldAt: true },
    take: 20_000,
  })
  const characterIds = [...new Set(trades.flatMap(row => [row.sellerCharacterId, row.buyerCharacterId!]))]
  const owners = await prisma.character.findMany({
    where: { id: { in: characterIds } },
    select: { id: true, userId: true },
  })
  const userOf = new Map(owners.map(row => [row.id, row.userId]))
  for (const trade of trades) {
    const seller = userOf.get(trade.sellerCharacterId)
    const buyer = userOf.get(trade.buyerCharacterId!)
    if (!seller || !buyer) continue
    add(seller, buyer, 'MARKET_TRADE', 1, { price: trade.price }, trade.soldAt ?? now)
  }

  // 3. Общий клан.
  const members = await prisma.clanMember.findMany({
    where: { status: 'ACTIVE' },
    select: { clanId: true, characterId: true, joinedAt: true },
    take: 20_000,
  })
  const memberUsers = await prisma.character.findMany({
    where: { id: { in: members.map(row => row.characterId) } },
    select: { id: true, userId: true },
  })
  const memberUserOf = new Map(memberUsers.map(row => [row.id, row.userId]))
  const byClan = new Map<string, string[]>()
  for (const member of members) {
    const userId = memberUserOf.get(member.characterId)
    if (!userId) continue
    byClan.set(member.clanId, [...(byClan.get(member.clanId) ?? []), userId])
  }
  for (const [clanId, ids] of byClan) {
    if (ids.length < 2 || ids.length > 40) continue
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        add(ids[i], ids[j], 'SAME_CLAN', 0.5, { clanId }, now)
      }
    }
  }

  for (const [key, edge] of edges) {
    const [userAId, userBId] = key.split('|')
    await prisma.accountLink.upsert({
      where: { userAId_userBId_kind: { userAId, userBId, kind: edge.kind } },
      update: { weight: edge.weight, evidence: edge.evidence, lastSeenAt: edge.at },
      create: {
        userAId, userBId, kind: edge.kind,
        weight: edge.weight, evidence: edge.evidence, lastSeenAt: edge.at,
      },
    })
  }
  return edges.size
}

// ── Детекторы ───────────────────────────────────────────────

/**
 * Мультиаккаунт: общий IP ПЛЮС поток ценностей.
 *
 * На голом совпадении адреса сигнал не поднимается. Иначе первым же утром
 * админ получит список из всех семей и общежитий, перестанет читать ленту, и
 * настоящий мультиаккаунт утонет среди них.
 */
export async function detectMultiAccounts(_now = new Date()): Promise<number> {
  const shared = await prisma.accountLink.findMany({ where: { kind: 'SHARED_IP' }, take: 5_000 })
  let raised = 0
  for (const link of shared) {
    const trade = await prisma.accountLink.findUnique({
      where: {
        userAId_userBId_kind: {
          userAId: link.userAId, userBId: link.userBId, kind: 'MARKET_TRADE',
        },
      },
    })
    if (!trade) continue
    const logins = await prisma.user.findMany({
      where: { id: { in: [link.userAId, link.userBId] } },
      select: { id: true, login: true },
    })
    const names = logins.map(row => row.login).join(' и ')
    const created = await raise({
      kind: 'MULTI_ACCOUNT',
      severity: 2,
      userIds: [link.userAId, link.userBId],
      summary: `Аккаунты ${names} заходили с одного адреса и торговали между собой`,
      evidence: { ip: link.evidence, trade: trade.evidence, lastSeenAt: link.lastSeenAt },
      dedupeKey: `${link.userAId}|${link.userBId}`,
    })
    if (created) raised += 1
  }
  return raised
}

/**
 * Договорные бои: пара, которая дерётся часто и всегда с одним исходом.
 *
 * Оба условия обязательны. Часто дерущаяся пара — это друзья; пара с
 * односторонним счётом — это разница в силе; вместе — повод посмотреть.
 */
export async function detectMatchFixing(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 3 * DAY)
  const battles = await prisma.battle.findMany({
    where: { type: 'PVP_DUEL', status: 'FINISHED', finishedAt: { gte: since } },
    select: { id: true, winnerId: true, participants: { select: { characterId: true } } },
    take: 5_000,
  })

  const pairs = new Map<string, { total: number; wins: Map<string, number> }>()
  for (const battle of battles) {
    const ids = battle.participants.map(row => row.characterId).filter(Boolean) as string[]
    if (ids.length !== 2) continue
    const [a, b] = pair(ids[0], ids[1])
    const key = `${a}|${b}`
    const entry = pairs.get(key) ?? { total: 0, wins: new Map<string, number>() }
    entry.total += 1
    if (battle.winnerId) entry.wins.set(battle.winnerId, (entry.wins.get(battle.winnerId) ?? 0) + 1)
    pairs.set(key, entry)
  }

  let raised = 0
  for (const [key, entry] of pairs) {
    if (entry.total < 10) continue
    const best = [...entry.wins.entries()].sort((x, y) => y[1] - x[1])[0]
    if (!best || best[1] / entry.total < 0.8) continue

    const [a, b] = key.split('|')
    const characters = await prisma.character.findMany({
      where: { id: { in: [a, b] } },
      select: { id: true, nickname: true, userId: true, battleLevel: true },
    })
    const winner = characters.find(row => row.id === best[0])
    const summary = `${characters.map(row => row.nickname).join(' и ')}: `
      + `${entry.total} боёв за трое суток, ${best[1]} побед у ${winner?.nickname ?? 'одного'}`
    const created = await raise({
      kind: 'MATCH_FIXING',
      severity: 2,
      userIds: characters.map(row => row.userId),
      summary,
      evidence: { battles: entry.total, wins: best[1], winnerId: best[0] },
      dedupeKey: `${key}|${day(now)}`,
    })
    if (created) raised += 1
  }
  return raised
}

/**
 * Односторонний поток денег между парой.
 *
 * Отличается от лимита пары тем, что смотрит на НАПРАВЛЕНИЕ и на неделю
 * целиком: лимит ловит объём за сутки, а перелив может идти по чуть-чуть.
 */
export async function detectMoneyFunnel(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 7 * DAY)
  const trades = await prisma.marketListing.findMany({
    where: { status: 'SOLD', soldAt: { gte: since }, buyerCharacterId: { not: null } },
    select: { sellerCharacterId: true, buyerCharacterId: true, price: true },
    take: 20_000,
  })

  const flows = new Map<string, { forward: number; backward: number }>()
  for (const trade of trades) {
    const [a, b] = pair(trade.sellerCharacterId, trade.buyerCharacterId!)
    const key = `${a}|${b}`
    const entry = flows.get(key) ?? { forward: 0, backward: 0 }
    // «Вперёд» — от лексикографически меньшего к большему.
    if (trade.buyerCharacterId === b) entry.forward += trade.price
    else entry.backward += trade.price
    flows.set(key, entry)
  }

  let raised = 0
  for (const [key, flow] of flows) {
    const total = flow.forward + flow.backward
    if (total < 100_000) continue
    const share = Math.max(flow.forward, flow.backward) / total
    if (share < 0.9) continue

    const [a, b] = key.split('|')
    const characters = await prisma.character.findMany({
      where: { id: { in: [a, b] } },
      select: { id: true, nickname: true, userId: true },
    })
    const created = await raise({
      kind: 'MONEY_FUNNEL',
      severity: 2,
      userIds: characters.map(row => row.userId),
      summary: `${characters.map(row => row.nickname).join(' и ')}: `
        + `${Math.round(total)} ₽ за неделю, ${Math.round(share * 100)}% в одну сторону`,
      evidence: { total, forward: flow.forward, backward: flow.backward, share },
      dedupeKey: `${key}|${day(now)}`,
    })
    if (created) raised += 1
  }
  return raised
}

/** Ограбления: бригада вынесла из чужих объектов больше нормы за сутки. */
export async function detectRobberyStreak(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - DAY)
  const attacks = await prisma.objectAttack.findMany({
    where: { type: 'ROBBERY', createdAt: { gte: since } },
    select: { attackerClanId: true, moneyTaken: true },
    take: 5_000,
  })
  const byClan = new Map<string, number>()
  for (const attack of attacks) {
    byClan.set(attack.attackerClanId, (byClan.get(attack.attackerClanId) ?? 0) + attack.moneyTaken)
  }

  let raised = 0
  for (const [clanId, taken] of byClan) {
    if (taken < 40_000) continue
    const clan = await prisma.clan.findUnique({ where: { id: clanId }, select: { name: true, tag: true } })
    const created = await raise({
      kind: 'ROBBERY_STREAK',
      severity: 1,
      userIds: [],
      summary: `Бригада [${clan?.tag}] ${clan?.name} вынесла ${taken} ₽ из чужих объектов за сутки`,
      evidence: { clanId, taken },
      dedupeKey: `${clanId}|${day(now)}`,
    })
    if (created) raised += 1
  }
  return raised
}

/**
 * Возврат взноса за заявку.
 *
 * Сигнал не о нарушении, а о редком событии: возврат случается ровно тогда,
 * когда к часу боя у нападающей стороны не осталось ни одного бойца, то есть
 * все они удалены. Это может быть и чистка мультиаккаунтов, и дефект — и
 * админ обязан увидеть каждый случай.
 */
export async function detectRefundedClaims(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 7 * DAY)
  const claims = await prisma.territoryClaim.findMany({
    where: { status: 'EXPIRED', resolvedAt: { gte: since } },
    select: {
      id: true, feePaid: true, attackerClanId: true, resolvedAt: true,
      territory: { select: { code: true } },
      attackerClan: { select: { tag: true } },
    },
    take: 500,
  })

  let raised = 0
  for (const claim of claims) {
    const created = await raise({
      kind: 'CLAIM_REFUNDED',
      severity: 1,
      userIds: [],
      summary: `Заявка бригады [${claim.attackerClan.tag}] на район ${claim.territory.code} `
        + `погашена с возвратом ${claim.feePaid} ₽: к часу боя не осталось нападающих`,
      evidence: { claimId: claim.id, feePaid: claim.feePaid, resolvedAt: claim.resolvedAt },
      dedupeKey: claim.id,
    })
    if (created) raised += 1
  }
  return raised
}

/**
 * Ловушка с переводом объекта.
 *
 * Перевод объекта в бригаду необратим по замыслу — иначе бригада становится
 * отмывочной. Связка «переведи, потом выгоню» это единственный способ отнять
 * у игрока объект насовсем, и разбирать её должен человек: это мошенничество
 * между людьми, а не дисбаланс.
 */
export async function detectObjectTransferTrap(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 30 * DAY)
  const transfers = await prisma.productionLog.findMany({
    where: { eventType: 'TRANSFERRED_TO_CLAN', createdAt: { gte: since } },
    select: { id: true, characterId: true, productionObjectId: true, createdAt: true, metadataJson: true },
    take: 2_000,
  })

  let raised = 0
  for (const transfer of transfers) {
    if (!transfer.characterId) continue
    const member = await prisma.clanMember.findUnique({
      where: { characterId: transfer.characterId },
      select: { status: true, leftAt: true },
    })
    // Исключён вскоре после перевода — либо строки членства уже нет вовсе.
    const leftSoon = member?.leftAt
      && member.leftAt.getTime() - transfer.createdAt.getTime() < 72 * 3_600_000
      && member.leftAt > transfer.createdAt
    // Игрок либо ушёл вскоре после перевода, либо строки членства уже нет.
    if (member && member.status === 'ACTIVE' && !leftSoon) continue

    const character = await prisma.character.findUnique({
      where: { id: transfer.characterId },
      select: { nickname: true, userId: true },
    })
    const created = await raise({
      kind: 'OBJECT_TRANSFER_TRAP',
      severity: 3,
      userIds: character ? [character.userId] : [],
      summary: `${character?.nickname ?? 'Игрок'} перевёл объект в бригаду и вскоре покинул её: `
        + 'перевод необратим, объект остался у бригады',
      evidence: {
        objectId: transfer.productionObjectId,
        transferredAt: transfer.createdAt,
        leftAt: member?.leftAt ?? null,
      },
      dedupeKey: transfer.id,
    })
    if (created) raised += 1
  }
  return raised
}

/**
 * Сверка накопительных величин с их журналами.
 *
 * Дюп — единственный риск, который нельзя поймать эвристикой: его ловят
 * сверкой. Правило общее: у каждой накопительной величины есть журнал, и они
 * обязаны сходиться. Здесь сверяется авторитет бригады — единственная
 * величина, у которой журнал полон с первого дня.
 */
export async function detectLedgerMismatch(now = new Date()): Promise<number> {
  const clans = await prisma.clan.findMany({ select: { id: true, name: true, tag: true, authority: true } })
  let raised = 0
  for (const clan of clans) {
    const sum = await prisma.clanAuthorityLog.aggregate({
      where: { clanId: clan.id },
      _sum: { amount: true },
    })
    const fromLog = sum._sum.amount ?? 0
    if (Math.abs(fromLog - clan.authority) < 1e-6) continue
    const created = await raise({
      kind: 'DUPLICATION',
      severity: 3,
      userIds: [],
      summary: `Авторитет бригады [${clan.tag}] ${clan.name} не сходится с журналом: `
        + `поле ${clan.authority}, журнал ${fromLog}`,
      evidence: { clanId: clan.id, stored: clan.authority, fromLog },
      dedupeKey: `${clan.id}|${day(now)}`,
    })
    if (created) raised += 1
  }
  return raised
}

/** Полный разбор. Возвращает, сколько сигналов поднято по каждому виду. */
export async function runDetectors(now = new Date()) {
  const edges = await rebuildAccountGraph(now)
  const [multi, fixing, funnel, robbery, refunded, trap, ledger] = [
    await detectMultiAccounts(now),
    await detectMatchFixing(now),
    await detectMoneyFunnel(now),
    await detectRobberyStreak(now),
    await detectRefundedClaims(now),
    await detectObjectTransferTrap(now),
    await detectLedgerMismatch(now),
  ]
  return {
    edges,
    MULTI_ACCOUNT: multi,
    MATCH_FIXING: fixing,
    MONEY_FUNNEL: funnel,
    ROBBERY_STREAK: robbery,
    CLAIM_REFUNDED: refunded,
    OBJECT_TRANSFER_TRAP: trap,
    DUPLICATION: ledger,
  }
}

export const AntiAbuseService = {
  raise,
  rebuildAccountGraph,
  runDetectors,

  /** Лента сигналов для админки. */
  async list(params: {
    status?: 'OPEN' | 'REVIEWED' | 'DISMISSED'
    kind?: AbuseSignalKind
    severity?: number
    cursor?: string
    limit?: number
  }) {
    const take = Math.min(Math.max(1, params.limit ?? 50), 200)
    const rows = await prisma.abuseSignal.findMany({
      where: {
        ...(params.status ? { status: params.status } : {}),
        ...(params.kind ? { kind: params.kind } : {}),
        ...(params.severity ? { severity: params.severity } : {}),
      },
      take: take + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    })
    return { items: rows.slice(0, take), nextCursor: rows.length > take ? rows[take - 1].id : null }
  },

  /** Связи аккаунта — то, с чего админ начинает разбор мультиаккаунта. */
  async linksOf(userId: string) {
    const rows = await prisma.accountLink.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: { weight: 'desc' },
      take: 100,
    })
    const others = rows.map(row => (row.userAId === userId ? row.userBId : row.userAId))
    const users = await prisma.user.findMany({
      where: { id: { in: others } },
      select: { id: true, login: true, status: true },
    })
    const byId = new Map(users.map(row => [row.id, row]))
    return {
      items: rows.map(row => {
        const otherId = row.userAId === userId ? row.userBId : row.userAId
        return {
          userId: otherId,
          login: byId.get(otherId)?.login ?? null,
          status: byId.get(otherId)?.status ?? null,
          kind: row.kind,
          weight: row.weight,
          evidence: row.evidence,
          lastSeenAt: row.lastSeenAt,
        }
      }),
    }
  },
}

export const ANTIABUSE_LIMITS = BalanceConfig.antiAbuse
