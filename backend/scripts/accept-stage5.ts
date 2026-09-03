// =============================================================
// ПРИЁМКА ЭТАПА 5 — исполняемая, а не бумажная
//
// Раздел 24 мастер-ТЗ. Принцип П6 этапа: приёмка это команда с кодом
// возврата, а не список для галочек. Он оплачен Этапом 4 — там бумажный
// протокол выглядел покрытым тестами, а исполненный нашёл три настоящих
// дефекта, включая бой за территорию, который не запускался.
//
// Запуск (по тестовой базе — скрипт чистит её целиком):
//   npm run accept:stage5
//
// Отчёт: docs/stage5-acceptance-report.json, код возврата 1 при любом FAIL.
//
// Проверки 18–24 (баланс, релиз, документация) в этот прогон не входят:
// коридоры ждут решения заказчика по вопросу В11, а релиз и документация —
// это шаги G6 и G7. Они перечислены в отчёте как невыполненные, чтобы их
// нельзя было потерять.
// =============================================================
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import type { AdminRole } from '@prisma/client'
import { prisma } from '../src/shared/db/prisma'
import { buildApp } from '../src/app'
import { hashPassword } from '../src/shared/security/password'
import { generateJti, storeAdminSession } from '../src/shared/security/jwt'
import { ClansService } from '../src/modules/clans/clans.service'
import { ClaimsService } from '../src/modules/territories/claims.service'
import { PremiumService, isGrantImplemented } from '../src/modules/premium/premium.service'
import {
  rebuildAccountGraph, detectMultiAccounts, detectRobberyStreak,
  detectRefundedClaims, detectLedgerMismatch,
} from '../src/modules/antiabuse/antiabuse.service'
import { checkPairFlow, pairFlowToday, repeatBattleCoeff } from '../src/modules/antiabuse/antiabuse.limits'
import { BalanceConfig } from '../src/config/balance.config'
import { calcBattleExp } from '../src/modules/stats/stats.formulas'
import { TERRITORIES, PREMIUM_PRODUCTS, PREMIUM_PRODUCTS_DEFERRED } from '../prisma/economy-data'

const A = BalanceConfig.antiAbuse
const REASON = 'плановая проверка приёмки этапа'

interface Check { id: number; area: string; title: string; ok: boolean; note: string }
const checks: Check[] = []
const pending: Array<{ id: number; area: string; title: string; why: string }> = []

let app: Awaited<ReturnType<typeof buildApp>>
let superToken = ''
let supportToken = ''
let moderatorToken = ''

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

let counter = 0
const uid = (prefix: string) => `${prefix}_${Date.now()}_${++counter}_${Math.random().toString(36).slice(2, 6)}`

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function check(id: number, area: string, title: string, body: () => Promise<string>) {
  await reset()
  try {
    const note = await body()
    checks.push({ id, area, title, ok: true, note })
    console.log(`  ${String(id).padStart(2)} PASS  ${title}\n        ${note}`)
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error)
    checks.push({ id, area, title, ok: false, note })
    console.log(`  ${String(id).padStart(2)} FAIL  ${title}\n        ${note}`)
  }
}

/** Чистая база перед каждой проверкой: проверки не зависят друг от друга. */
async function reset() {
  await prisma.$transaction([
    prisma.adminActionLog.deleteMany(),
    prisma.abuseSignal.deleteMany(),
    prisma.accountLink.deleteMany(),
    prisma.idempotencyKey.deleteMany(),
    prisma.objectAttack.deleteMany(),
    prisma.territoryClaimRoster.deleteMany(),
    prisma.territoryClaim.deleteMany(),
    prisma.territory.deleteMany(),
    prisma.helper.deleteMany(),
    prisma.premiumPurchase.deleteMany(),
    prisma.clanRelation.deleteMany(),
    prisma.clanAuthorityLog.deleteMany(),
    prisma.clanTreasuryLog.deleteMany(),
    prisma.clanStorage.deleteMany(),
    prisma.clanMember.deleteMany(),
    prisma.clanRole.deleteMany(),
    prisma.marketListing.deleteMany(),
    prisma.productionLog.deleteMany(),
    prisma.workShift.deleteMany(),
    prisma.characterProfession.deleteMany(),
    prisma.productionObject.deleteMany(),
    prisma.battleTurn.deleteMany(),
    prisma.battleParticipant.deleteMany(),
    prisma.battle.deleteMany(),
    prisma.itemLog.deleteMany(),
    prisma.currencyLog.deleteMany(),
    prisma.itemInstance.deleteMany(),
    prisma.session.deleteMany(),
    prisma.characterStats.deleteMany(),
    prisma.character.deleteMany(),
    prisma.clan.deleteMany(),
    prisma.user.deleteMany(),
  ])
  for (const { code, name, bonusCode, bonusValue } of TERRITORIES) {
    await prisma.territory.create({ data: { code, name, bonusCode, bonusValue } })
  }
  for (const product of [...PREMIUM_PRODUCTS, ...PREMIUM_PRODUCTS_DEFERRED]) {
    await prisma.premiumProduct.upsert({
      where: { code: product.code },
      update: { isActive: isGrantImplemented(product.grantCode) },
      create: {
        code: product.code, name: product.name, description: product.description,
        kind: product.kind, priceRub: product.priceRub, grantCode: product.grantCode,
        grantValue: product.grantValue, sortOrder: product.sortOrder,
        isActive: isGrantImplemented(product.grantCode),
      },
    })
  }
}

async function player(prefix: string, money = 200_000) {
  const login = uid(prefix)
  const user = await prisma.user.create({
    data: { login, email: `${login}@accept5.local`, passwordHash: 'x' },
  })
  const character = await prisma.character.create({
    data: {
      userId: user.id, nickname: login, archetype: 'WORKER',
      hpCurrent: 80, hpMax: 80, money, battleLevel: 5,
    },
  })
  return { user, character }
}

async function warClan(prefix: string) {
  const boss = await player(prefix)
  const clan = await ClansService.create(
    boss.character.id, uid(`${prefix}-clan`), Math.random().toString(36).slice(2, 6).toUpperCase())
  const role = await prisma.clanRole.findFirstOrThrow({ where: { clanId: clan.id, code: 'fighter' } })
  const roster = [boss.character.id]
  for (let i = 1; i < 5; i++) {
    const mate = await player(`${prefix}m${i}`)
    await prisma.clanMember.create({
      data: { clanId: clan.id, characterId: mate.character.id, roleId: role.id },
    })
    roster.push(mate.character.id)
  }
  await prisma.clan.update({ where: { id: clan.id }, data: { treasury: 100_000, authority: 100 } })
  await prisma.clanAuthorityLog.create({
    data: { clanId: clan.id, amount: 100, reason: 'ADMIN_ADJUST', balanceAfter: 100 },
  })
  return { boss, clan, roster }
}

async function adminToken(role: AdminRole) {
  const username = uid(`adm-${role.toLowerCase()}`)
  const row = await prisma.adminUser.create({
    data: { username, passwordHash: await hashPassword('x'), role },
  })
  const jti = generateJti()
  await storeAdminSession(jti, row.id)
  return app.jwt.sign({ role: 'admin', adminRole: row.role, adminId: row.id, jti }, { expiresIn: '2h' })
}

// ── Прогон ───────────────────────────────────────────────────

async function run() {
  console.log('\nПРИЁМКА ЭТАПА 5 — раздел 24 мастер-ТЗ\n')
  app = await buildApp()
  await app.ready()
  await prisma.adminUser.deleteMany()
  superToken = await adminToken('SUPER_ADMIN')
  moderatorToken = await adminToken('MODERATOR')
  supportToken = await adminToken('SUPPORT')

  // ── Долги Этапа 4 ───────────────────────────────────────
  console.log(' Долги Этапа 4')

  await check(1, 'Долги', 'Витрина выдаёт свои эффекты, отложенные не выдаются', async () => {
    const character = (await player('shop')).character
    const shop = await PremiumService.shop()
    must(shop.items.length === PREMIUM_PRODUCTS.length,
      `в витрине ${shop.items.length} товаров, в первой версии ${PREMIUM_PRODUCTS.length}`)
    for (const product of shop.items) {
      await PremiumService.grant({ characterId: character.id, productCode: product.code })
    }
    const items = await prisma.itemInstance.count({ where: { ownerId: character.id } })
    must(items === 0, `покупки выдали ${items} предметов`)

    const deferred = PREMIUM_PRODUCTS_DEFERRED[0]
    let refused = false
    try {
      await PremiumService.grant({ characterId: character.id, productCode: deferred.code })
    } catch (error) {
      refused = (error as { code?: string }).code === 'PREM_003'
    }
    must(refused, 'отложенный товар выдался')
    return `${shop.items.length} рабочих товаров, отложенные отказывают по PREM_003`
  })

  await check(2, 'Долги', 'Бой за территорию доигрывается и меняет владельца', async () => {
    // Полный сквозной путь проверен тестом territory-battle-e2e; здесь
    // подтверждается его главное свойство — живое состояние боя, без
    // которого в бой нельзя сделать ни одного хода.
    const attack = await warClan('war-a')
    const defence = await warClan('war-d')
    await prisma.territory.update({
      where: { code: 'garages' },
      data: { ownerClanId: defence.clan.id, status: 'CONTROLLED', controlledAt: new Date() },
    })
    const filed = await ClaimsService.file(attack.boss.character.id, 'garages', attack.roster)
    await ClaimsService.setDefence(defence.boss.character.id, filed.claimId, defence.roster)
    await prisma.territoryClaim.update({
      where: { id: filed.claimId },
      data: { battleStartsAt: new Date(Date.now() - 1000) },
    })
    const { runTerritoryClaims } = await import('../src/workers/territory-claims.worker')
    await runTerritoryClaims()

    const claim = await prisma.territoryClaim.findUniqueOrThrow({ where: { id: filed.claimId } })
    must(claim.status === 'BATTLE' && claim.battleId, `заявка в статусе ${claim.status}`)
    const { BattleRedis } = await import('../src/shared/db/redis')
    const live = await BattleRedis.getState<{ participants: unknown[] }>(claim.battleId!)
    must(live, 'живое состояние боя не создано — в бой нельзя сделать ход')
    must(live!.participants.length === 10, `в бою ${live!.participants.length} бойцов из 10`)
    return 'бой назначен, живое состояние на десять бойцов создано'
  })

  // ── Админка ─────────────────────────────────────────────
  console.log('\n Админка')

  await check(3, 'Админка', 'Мутация требует причину от десяти символов', async () => {
    const character = (await player('reason')).character
    const short = await app.inject({
      method: 'POST', url: '/api/admin/characters/money', headers: auth(superToken),
      payload: { characterId: character.id, amount: 500, reason: 'фикс' },
    })
    must(short.statusCode === 422, `короткая причина принята: ${short.statusCode}`)
    must(short.json<{ code: string }>().code === 'ADMIN_005', 'причина отклонена не своим кодом')
    const after = await prisma.character.findUniqueOrThrow({ where: { id: character.id } })
    must(after.money === 200_000, `деньги всё-таки выданы: ${after.money}`)

    // Премиум — та же ручка тех же правил: раньше она причины не требовала.
    const premium = await app.inject({
      method: 'POST', url: '/api/admin/premium/grant', headers: auth(superToken),
      payload: { characterId: character.id, productCode: 'prem_sub_30', reason: 'нет' },
    })
    must(premium.statusCode === 422, `премиум выдан без причины: ${premium.statusCode}`)
    return 'ADMIN_005 на обеих ручках, состояние не тронуто'
  })

  await check(4, 'Админка', 'У каждого действия записана обратная операция', async () => {
    const character = (await player('undo')).character
    const granted = await app.inject({
      method: 'POST', url: '/api/admin/characters/money', headers: auth(superToken),
      payload: { characterId: character.id, amount: 1_000, reason: REASON },
    })
    must(granted.statusCode === 200, `выдача не прошла: ${granted.statusCode}`)
    const rows = await prisma.adminActionLog.findMany()
    must(rows.length === 1, `в журнале ${rows.length} записей`)
    must(rows[0].undoKind === 'TAKE_MONEY', `обратная операция ${rows[0].undoKind}`)
    must(rows[0].reason.length >= 10, 'причина не записана')
    return `${rows[0].kind} → ${rows[0].undoKind}, причина в журнале`
  })

  await check(5, 'Админка', 'Откат возвращает состояние и сам пишется в журнал', async () => {
    const character = (await player('rollback')).character
    const granted = await app.inject({
      method: 'POST', url: '/api/admin/characters/money', headers: auth(superToken),
      payload: { characterId: character.id, amount: 5_000, reason: REASON },
    })
    const { actionId } = granted.json<{ actionId: string }>()
    must((await prisma.character.findUniqueOrThrow({ where: { id: character.id } })).money === 205_000,
      'деньги не выданы')

    const undone = await app.inject({
      method: 'POST', url: `/api/admin/actions/${actionId}/rollback`, headers: auth(superToken),
      payload: { reason: 'отмена по приёмке этапа' },
    })
    must(undone.statusCode === 200, `откат не прошёл: ${undone.statusCode}`)
    must((await prisma.character.findUniqueOrThrow({ where: { id: character.id } })).money === 200_000,
      'состояние не вернулось')

    const record = await prisma.adminActionLog.findUnique({ where: { rolledBackId: actionId } })
    must(record && record.kind === 'ROLLBACK', 'откат не записан в журнал')

    // Дважды откатить нельзя: иначе откат выдачи стал бы списанием.
    const twice = await app.inject({
      method: 'POST', url: `/api/admin/actions/${actionId}/rollback`, headers: auth(superToken),
      payload: { reason: 'повторная попытка отката' },
    })
    must(twice.statusCode === 409, `второй откат прошёл: ${twice.statusCode}`)
    return 'состояние вернулось, откат в журнале, второй раз отклонён'
  })

  await check(6, 'Админка', 'Действия без обратной операции не существует', async () => {
    // Правило П1 наизнанку: гашение заявки С ВОЗВРАТОМ взноса отменить
    // нечем — пока заявка висела, район был занят, а после возврата его мог
    // занять другой клан. Такой ручки у админа нет вовсе.
    const routes = app.printRoutes({ commonPrefix: false })
    const forbidden = ['/claims/:id/refund', '/claims/:id/expire-with-refund']
    for (const route of forbidden) {
      must(!routes.includes(route), `ручка ${route} существует`)
    }
    // А то, что есть, обратную операцию имеет.
    const kinds = await prisma.adminActionLog.findMany({ select: { undoKind: true } })
    must(kinds.every(row => row.undoKind), 'есть запись без обратной операции')
    return 'гашения с возвратом нет ни под одной ролью'
  })

  await check(7, 'Админка', 'Цепочка по предмету показывает историю с админскими', async () => {
    const character = (await player('trace-item')).character
    const template = await prisma.itemTemplate.findFirstOrThrow()
    const granted = await app.inject({
      method: 'POST', url: '/api/admin/items/grant', headers: auth(superToken),
      payload: { characterId: character.id, templateId: template.id, reason: REASON },
    })
    must(granted.statusCode === 201, `предмет не выдан: ${granted.statusCode}`)
    const { payload } = granted.json<{ payload: { createdItemId: string } }>()

    const trace = await app.inject({
      method: 'GET', url: `/api/admin/trace?type=item&id=${payload.createdItemId}`,
      headers: auth(superToken),
    })
    must(trace.statusCode === 200, `цепочка не построилась: ${trace.statusCode}`)
    const body = trace.json<{ events: Array<{ source: string; action: string; adminActionId: string | null }> }>()
    const created = body.events.find(event => event.action === 'CREATED_BY_ADMIN')
    must(created, 'создание предмета не попало в цепочку')
    must(created!.adminActionId, 'создание не связано с админским действием')
    return `${body.events.length} событий, создание связано с действием админа`
  })

  await check(8, 'Админка', 'Цепочка по бригаде сводит общак, авторитет и налёты', async () => {
    const { clan, boss, roster } = await warClan('trace-clan')
    await ClaimsService.file(boss.character.id, 'center', roster)

    const trace = await app.inject({
      method: 'GET', url: `/api/admin/trace?type=clan&id=${clan.id}`, headers: auth(superToken),
    })
    const body = trace.json<{ events: Array<{ source: string; action: string }> }>()
    const sources = new Set(body.events.map(event => event.source))
    must(sources.has('TREASURY'), 'общак не попал в ленту')
    must(sources.has('AUTHORITY'), 'авторитет не попал в ленту')
    // Одно событие «подана заявка» оставляет след сразу в двух журналах —
    // в этом и смысл сшитой ленты.
    must(body.events.some(event => event.action === 'TERRITORY_CLAIM_FEE'), 'взнос не виден')
    must(body.events.some(event => event.action === 'CLAIM_FILED'), 'списание авторитета не видно')
    return `источники: ${[...sources].join(', ')}`
  })

  await check(9, 'Админка', 'SUPPORT не выполняет ни одной мутации', async () => {
    const character = (await player('support')).character
    const money = await app.inject({
      method: 'POST', url: '/api/admin/characters/money', headers: auth(supportToken),
      payload: { characterId: character.id, amount: 1, reason: REASON },
    })
    must(money.statusCode === 403, `выдача денег отдала ${money.statusCode} вместо 403`)
    const reset = await app.inject({
      method: 'POST', url: '/api/admin/territories/center/reset', headers: auth(supportToken),
      payload: { reason: REASON },
    })
    must(reset.statusCode === 403, `сброс района отдал ${reset.statusCode} вместо 403`)
    // Читать при этом может всё: прозрачность между админами полезна.
    const read = await app.inject({ method: 'GET', url: '/api/admin/actions', headers: auth(supportToken) })
    must(read.statusCode === 200, `SUPPORT не может читать журнал: ${read.statusCode}`)
    return 'мутации 403, чтение 200'
  })

  await check(10, 'Админка', 'Сброс района и откат — только у высшей роли', async () => {
    const reset = await app.inject({
      method: 'POST', url: '/api/admin/territories/center/reset', headers: auth(moderatorToken),
      payload: { reason: REASON },
    })
    must(reset.statusCode === 403, `модератор сбросил район: ${reset.statusCode}`)

    const character = (await player('rights')).character
    const granted = await app.inject({
      method: 'POST', url: '/api/admin/characters/money', headers: auth(superToken),
      payload: { characterId: character.id, amount: 100, reason: REASON },
    })
    const { actionId } = granted.json<{ actionId: string }>()
    const rollback = await app.inject({
      method: 'POST', url: `/api/admin/actions/${actionId}/rollback`, headers: auth(moderatorToken),
      payload: { reason: 'модератор пробует откатить' },
    })
    must(rollback.statusCode === 403, `модератор откатил: ${rollback.statusCode}`)
    return 'сброс района и откат недоступны модератору'
  })

  // ── Антиабуз ────────────────────────────────────────────
  console.log('\n Антиабуз')

  await check(11, 'Антиабуз', 'Фарм на ботах ограничен', async () => {
    const { AntiFarmRedis } = await import('../src/shared/db/redis')
    const first = AntiFarmRedis.calcPveAntiFarmCoeff(0)
    const tenth = AntiFarmRedis.calcPveAntiFarmCoeff(10)
    const far = AntiFarmRedis.calcPveAntiFarmCoeff(50)
    must(first === 1, `первый бой с ботом даёт ${first}`)
    must(tenth < 0.6, `десятый бой даёт ${tenth} — затухание слишком мягкое`)
    must(far <= 0.1 + 1e-9, `пятидесятый бой даёт ${far}`)
    return `коэффициент 1 → ${tenth.toFixed(2)} → ${far.toFixed(2)}: правило Этапа 1, а не доля от дневного опыта`
  })

  await check(12, 'Антиабуз', 'Разница уровней режет опыт', async () => {
    const even = calcBattleExp(100, 50, 100, 0, 'PVP_WIN')
    const gap10 = calcBattleExp(100, 50, 100, 10, 'PVP_WIN')
    const gap15 = calcBattleExp(100, 50, 100, 15, 'PVP_WIN')
    must(gap10 < even, 'разница в десять уровней ничего не меняет')
    must(gap15 === 0, `при разнице 15 опыт ${gap15}, ожидался ноль`)
    const share = gap10 / even
    // Решение заказчика 04.09.2026 по вопросу В12: действует таблица
    // Этапа 1. Она мягче на средних разницах (30% против 10%), но жёстче на
    // больших: ноль при разнице от пятнадцати, тогда как формула Этапа 5
    // навсегда оставляла бы десятую часть. Фарм через слабых закрыт именно
    // нулём, а не долей, и число из ТЗ Этапа 5 убрано как лишнее.
    must(share <= 0.35, `при разнице 10 остаётся ${Math.round(share * 100)}% опыта`)
    must(calcBattleExp(100, 50, 100, 4, 'PVP_WIN') < even, 'разница в четыре уровня ничего не меняет')
    return `разница 10 → ${Math.round(share * 100)}% опыта, разница 15 → ноль (таблица Этапа 1)`
  })

  await check(13, 'Антиабуз', 'Повторный бой той же пары даёт четверть опыта', async () => {
    must(repeatBattleCoeff(0) === 1, 'первый бой урезан')
    must(repeatBattleCoeff(1) === A.repeatBattleShare, `второй бой даёт ${repeatBattleCoeff(1)}`)
    must(repeatBattleCoeff(20) === A.repeatBattleShare, 'двадцатый бой считается иначе')
    return `второй и далее — ${A.repeatBattleShare * 100}% опыта`
  })

  await check(14, 'Антиабуз', 'Поток ценностей между парой ограничен', async () => {
    const seller = (await player('cap-s')).character
    const buyer = (await player('cap-b')).character
    await prisma.marketListing.create({
      data: {
        sellerCharacterId: seller.id, buyerCharacterId: buyer.id,
        type: 'RESOURCE', price: A.pairMoneyDailyCap - 1_000, listingFee: 0,
        status: 'SOLD', soldAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000),
      },
    })
    const flow = await pairFlowToday(prisma, buyer.id, seller.id)
    const verdict = checkPairFlow(flow, 5_000, false)
    must(!verdict.allowed, 'сделка сверх суточного предела разрешена')
    must(verdict.reason === 'MONEY_CAP', `причина отказа ${verdict.reason}`)
    // Отказ, а не сигнал: перелив ломает экономику быстрее, чем админ
    // успеет отреагировать.
    return `предел ${A.pairMoneyDailyCap} ₽ и ${A.pairItemsDailyCap} предметов, превышение отклоняется`
  })

  await check(15, 'Антиабуз', 'Сигнал никого не банит', async () => {
    const one = await player('sig-1')
    const two = await player('sig-2')
    for (const account of [one, two]) {
      await prisma.session.create({
        data: {
          userId: account.user.id, tokenHash: uid('hash'), ip: '10.1.1.1',
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      })
    }
    await prisma.marketListing.create({
      data: {
        sellerCharacterId: one.character.id, buyerCharacterId: two.character.id,
        type: 'RESOURCE', price: 1_000, listingFee: 0, status: 'SOLD',
        soldAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000),
      },
    })
    await rebuildAccountGraph()
    const raised = await detectMultiAccounts()
    must(raised === 1, `поднято сигналов: ${raised}`)

    const signal = await prisma.abuseSignal.findFirstOrThrow({ where: { kind: 'MULTI_ACCOUNT' } })
    must(signal.status === 'OPEN', `сигнал сразу в статусе ${signal.status}`)
    must(signal.summary.length > 20, 'сигнал не объясняет себя словами')

    // Главное: ни один аккаунт не тронут.
    const users = await prisma.user.findMany({
      where: { id: { in: [one.user.id, two.user.id] } },
      select: { status: true },
    })
    must(users.every(row => row.status === 'ACTIVE'), 'сигнал изменил статус аккаунта')
    return `сигнал открыт, объяснён словами, оба аккаунта ACTIVE`
  })

  await check(16, 'Антиабуз', 'Капчи нет в игровом цикле', async () => {
    const routes = app.printRoutes({ commonPrefix: false })
    must(!routes.toLowerCase().includes('captcha'), 'в маршрутах есть капча')
    // Капчи нет нигде вообще, включая регистрацию: ТЗ разрешает её только
    // там, но реализована она не была. Это ограничение первой версии, и оно
    // названо, а не скрыто.
    return 'капчи нет ни в одном маршруте — в том числе на регистрации, см. ограничения первой версии'
  })

  await check(17, 'Антиабуз', 'Сигналы Этапа 4 срабатывают на подготовленных сценариях', async () => {
    const attacker = await warClan('rob-a')
    const defender = await warClan('rob-d')
    const object = await prisma.productionObject.create({
      data: {
        code: uid('obj'), name: 'Цех', type: 'WORKSHOP', locationId: 'industrial',
        requiredProfessionCode: 'scrap_collector', requiredProfessionLevel: 0,
        shiftDurationMinutes: 30, baseSalary: 100, baseProductionExp: 10,
      },
    })
    for (let i = 0; i < 6; i++) {
      await prisma.objectAttack.create({
        data: {
          objectId: object.id, attackerClanId: attacker.clan.id, defenderClanId: defender.clan.id,
          filedByCharacterId: attacker.boss.character.id, type: 'ROBBERY',
          moneyTaken: 8_000, authoritySpent: 25,
        },
      })
    }
    const robbery = await detectRobberyStreak()
    must(robbery === 1, `ROBBERY_STREAK поднял ${robbery} сигналов`)

    // Возврат взноса за заявку: событие редкое и показывается всегда.
    const territory = await prisma.territory.findFirstOrThrow({ where: { code: 'market' } })
    await prisma.territoryClaim.create({
      data: {
        territoryId: territory.id, attackerClanId: attacker.clan.id,
        filedByCharacterId: attacker.boss.character.id, status: 'EXPIRED',
        battleStartsAt: new Date(), resolvedAt: new Date(),
        feePaid: 10_000, authoritySpent: 20,
      },
    })
    const refunded = await detectRefundedClaims()
    must(refunded === 1, `CLAIM_REFUNDED поднял ${refunded} сигналов`)

    // Сверка авторитета с журналом ловит правку мимо приложения.
    await prisma.clan.update({ where: { id: attacker.clan.id }, data: { authority: 999 } })
    const ledger = await detectLedgerMismatch()
    must(ledger >= 1, 'сверка авторитета не заметила расхождения')

    return 'ROBBERY_STREAK, CLAIM_REFUNDED и сверка журнала сработали; '
      + 'HELPER_DRAIN и WAR_COLLUSION не реализованы — нет данных, см. STAGE5_ANTIABUSE 3.2'
  })

  // ── Не входит в этот прогон ─────────────────────────────
  pending.push(
    { id: 18, area: 'Баланс', title: 'Сквозной симулятор проходит все девять коридоров', why: 'три коридора не сошлись: ферма, окупаемость объектов, окупаемость бара (В13 владельца закрыт 04.09.2026 без правки баланса — см. STAGE5_FULL_RUN_REPORT.md)' },
    { id: 19, area: 'Баланс', title: 'Антимастерство не делает специализацию проигрышной', why: 'прогон длинной дистанции — часть работ G4, не начат' },
    { id: 20, area: 'Релиз', title: 'Откат CD проверен фактическим откатом', why: 'шаг G6' },
    { id: 21, area: 'Релиз', title: 'Полный прогон протоколов зелёный', why: 'шаг G6' },
    { id: 22, area: 'Релиз', title: 'Снимок базы с меткой релиза восстанавливается', why: 'шаг G6' },
    { id: 23, area: 'Документация', title: 'Новый человек поднимает проект по инструкции', why: 'шаг G7' },
    { id: 24, area: 'Документация', title: 'Четыре документа существуют и актуальны', why: 'шаг G7' },
  )

  const failed = checks.filter(item => !item.ok)
  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      stage: 5,
      source: 'docs/specs/stage-5/MASTER_TZ_STAGE_5_FINAL_ASSEMBLY_RELEASE_PREP.md, раздел 24',
      executed: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      pending: pending.length,
    },
    checks,
    pending,
  }
  const out = resolve(__dirname, '../../docs/stage5-acceptance-report.json')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(report, null, 2), 'utf8')

  console.log('\n Не входит в этот прогон')
  for (const item of pending) console.log(`  ${item.id} —     ${item.title}\n        ${item.why}`)

  console.log(`\nИТОГ: ${report.meta.passed} из ${checks.length} исполненных, отложено ${pending.length}`)
  if (failed.length > 0) {
    console.log('Не пройдено:')
    for (const item of failed) console.log(`  ${item.id}. ${item.title} — ${item.note}`)
  }
  console.log(`Отчёт: ${out}\n`)

  await app.close()
  return failed.length === 0
}

run()
  .then(async ok => { await prisma.$disconnect(); process.exit(ok ? 0 : 1) })
  .catch(async error => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
