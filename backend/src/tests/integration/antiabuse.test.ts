/**
 * Антиабуз — шаг G3 Этапа 5.
 *
 * Главное свойство, которое проверяется: сигнал НИКОГО НЕ НАКАЗЫВАЕТ. Он
 * поднимается, объясняет себя словами, несёт числа — и всё. Решает человек.
 *
 * Второе: жёсткие лимиты работают молча и отказывают, а не сигналят. Их два,
 * и оба про перелив — потому что перелив ломает экономику быстрее, чем админ
 * успеет отреагировать.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MarketService } from '../../modules/market/market.service'
import {
  rebuildAccountGraph, detectMultiAccounts, detectMatchFixing,
  detectMoneyFunnel, detectRobberyStreak, detectLedgerMismatch,
  detectMarketManipulation, raise,
} from '../../modules/antiabuse/antiabuse.service'
import {
  pairFlowToday, checkPairFlow, repeatBattleCoeff, pairBattlesToday,
} from '../../modules/antiabuse/antiabuse.limits'
import { ClansService } from '../../modules/clans/clans.service'
import { BalanceConfig } from '../../config/balance.config'
import { cleanDatabase, testPrisma, uid } from './helpers'

const A = BalanceConfig.antiAbuse

describe('антиабуз', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => {
    await cleanDatabase()
    await testPrisma.abuseSignal.deleteMany()
    await testPrisma.accountLink.deleteMany()
  })
  afterAll(async () => {
    await testPrisma.abuseSignal.deleteMany()
    await testPrisma.accountLink.deleteMany()
    await testPrisma.$disconnect()
  })

  async function player(prefix: string, money = 500_000) {
    const login = uid(prefix)
    const user = await testPrisma.user.create({
      data: { login, email: `${login}@test.local`, passwordHash: 'x' },
    })
    const character = await testPrisma.character.create({
      data: {
        userId: user.id, nickname: login, archetype: 'WORKER',
        hpCurrent: 80, hpMax: 80, money, battleLevel: 5,
      },
    })
    return { user, character }
  }

  /** Проданный лот: единственный канал движения денег между аккаунтами. */
  async function soldListing(sellerId: string, buyerId: string, price: number, at = new Date()) {
    return testPrisma.marketListing.create({
      data: {
        sellerCharacterId: sellerId, buyerCharacterId: buyerId,
        type: 'RESOURCE', price, listingFee: 0, status: 'SOLD', soldAt: at,
        expiresAt: new Date(at.getTime() + 3_600_000),
      },
    })
  }

  // ── Жёсткие лимиты ────────────────────────────────────────

  it('суточный предел пары считается по рынку — прямых передач в игре нет', async () => {
    const seller = await player('flow-s')
    const buyer = await player('flow-b')
    await soldListing(seller.character.id, buyer.character.id, 30_000)

    const flow = await pairFlowToday(testPrisma, buyer.character.id, seller.character.id)
    expect(flow.money).toBe(30_000)

    const fits = checkPairFlow(flow, 19_000, false)
    expect(fits.allowed).toBe(true)

    const over = checkPairFlow(flow, 21_000, false)
    expect(over.allowed).toBe(false)
    expect(over.reason).toBe('MONEY_CAP')
    expect(over.moneyCap).toBe(A.pairMoneyDailyCap)
  })

  it('покупка сверх суточного предела пары отклоняется, а не сигналится', async () => {
    const seller = await player('cap-s')
    const buyer = await player('cap-b')
    // Пара уже выбрала почти весь лимит за сегодня.
    await soldListing(seller.character.id, buyer.character.id, A.pairMoneyDailyCap - 1_000)

    const template = await testPrisma.resourceTemplate.findFirst()
    const listing = await testPrisma.marketListing.create({
      data: {
        sellerCharacterId: seller.character.id, type: 'RESOURCE',
        resourceTemplateId: template?.id ?? null, resourceAmount: 1,
        price: 5_000, listingFee: 0, status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    })

    await expect(MarketService.buy(buyer.character.id, listing.id, uid('key')))
      .rejects.toMatchObject({ code: 'MARKET_013' })

    // Лот не тронут, деньги не двинулись: отказ обязан быть полным.
    const after = await testPrisma.marketListing.findUniqueOrThrow({ where: { id: listing.id } })
    expect(after.status).toBe('ACTIVE')
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: buyer.character.id } })).money)
      .toBe(500_000)
  })

  it('повторный бой той же пары за сутки даёт четверть опыта', () => {
    expect(repeatBattleCoeff(0)).toBe(1)
    expect(repeatBattleCoeff(1)).toBe(A.repeatBattleShare)
    expect(repeatBattleCoeff(20)).toBe(A.repeatBattleShare)
  })

  it('счётчик боёв пары считает только сегодняшние и только общие', async () => {
    const one = await player('pair-1')
    const two = await player('pair-2')
    const three = await player('pair-3')

    const battleWith = async (a: string, b: string, finishedAt: Date) => {
      const battle = await testPrisma.battle.create({
        data: {
          type: 'PVP_DUEL', status: 'FINISHED', levelMin: 1, levelMax: 99, finishedAt,
        },
      })
      for (const [index, characterId] of [a, b].entries()) {
        await testPrisma.battleParticipant.create({
          data: { battleId: battle.id, characterId, side: index + 1, hpMax: 80, hpCurrent: 80 },
        })
      }
    }

    await battleWith(one.character.id, two.character.id, new Date())
    await battleWith(one.character.id, three.character.id, new Date())
    // Вчерашний бой той же пары не считается: лимит суточный.
    await battleWith(one.character.id, two.character.id, new Date(Date.now() - 36 * 3_600_000))

    expect(await pairBattlesToday(testPrisma, one.character.id, two.character.id)).toBe(1)
    expect(await pairBattlesToday(testPrisma, two.character.id, three.character.id)).toBe(0)
  })

  // ── Граф связей ───────────────────────────────────────────

  it('общий IP сам по себе сигнала не даёт: за адресом сидит семья', async () => {
    const one = await player('ip-1')
    const two = await player('ip-2')
    for (const account of [one, two]) {
      await testPrisma.session.create({
        data: {
          userId: account.user.id, tokenHash: uid('hash'), ip: '10.0.0.7',
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      })
    }

    await rebuildAccountGraph()
    const links = await testPrisma.accountLink.findMany()
    expect(links).toHaveLength(1)
    expect(links[0].kind).toBe('SHARED_IP')

    // Ребро есть, а сигнала нет — и это главное правило раздела.
    expect(await detectMultiAccounts()).toBe(0)
    expect(await testPrisma.abuseSignal.count()).toBe(0)
  })

  it('общий IP плюс сделка между ними — уже сигнал с объяснением', async () => {
    const one = await player('multi-1')
    const two = await player('multi-2')
    for (const account of [one, two]) {
      await testPrisma.session.create({
        data: {
          userId: account.user.id, tokenHash: uid('hash'), ip: '10.0.0.9',
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      })
    }
    await soldListing(one.character.id, two.character.id, 1_000)

    await rebuildAccountGraph()
    expect(await detectMultiAccounts()).toBe(1)

    const signal = await testPrisma.abuseSignal.findFirstOrThrow({ where: { kind: 'MULTI_ACCOUNT' } })
    expect(signal.severity).toBe(2)
    expect(signal.status).toBe('OPEN')
    expect(signal.userIds.sort()).toEqual([one.user.id, two.user.id].sort())
    // Объяснение словами: сигнал, который нельзя проверить, бесполезен.
    expect(signal.summary).toContain(one.user.login)
    expect(signal.summary).toContain('одного адреса')

    // Повторный прогон не плодит дубль.
    await detectMultiAccounts()
    expect(await testPrisma.abuseSignal.count({ where: { kind: 'MULTI_ACCOUNT' } })).toBe(1)
  })

  // ── Детекторы ─────────────────────────────────────────────

  it('договорные бои: нужны и частота, и односторонний счёт', async () => {
    const one = await player('fix-1')
    const two = await player('fix-2')

    const makeBattles = async (count: number, winnerId: string | null) => {
      for (let i = 0; i < count; i++) {
        const battle = await testPrisma.battle.create({
          data: {
            type: 'PVP_DUEL', status: 'FINISHED', levelMin: 1, levelMax: 99,
            finishedAt: new Date(), winnerId,
          },
        })
        for (const account of [one, two]) {
          await testPrisma.battleParticipant.create({
            data: {
              battleId: battle.id, characterId: account.character.id,
              side: account === one ? 1 : 2, hpMax: 80, hpCurrent: 80,
            },
          })
        }
      }
    }

    // Девять боёв — мало, сигнала нет даже при полном перевесе.
    await makeBattles(9, one.character.id)
    expect(await detectMatchFixing()).toBe(0)

    // Десятый добирает порог.
    await makeBattles(1, one.character.id)
    expect(await detectMatchFixing()).toBe(1)

    const signal = await testPrisma.abuseSignal.findFirstOrThrow({ where: { kind: 'MATCH_FIXING' } })
    expect(signal.summary).toContain('10 боёв')
    expect(signal.evidence).toMatchObject({ battles: 10, wins: 10 })
  })

  it('односторонний поток денег за неделю поднимает сигнал', async () => {
    const donor = await player('funnel-d')
    const taker = await player('funnel-t')
    // Пять сделок в одну сторону, каждая ниже суточного предела пары.
    for (let i = 0; i < 5; i++) {
      await soldListing(
        taker.character.id, donor.character.id, 25_000,
        new Date(Date.now() - i * 24 * 3_600_000),
      )
    }
    expect(await detectMoneyFunnel()).toBe(1)

    const signal = await testPrisma.abuseSignal.findFirstOrThrow({ where: { kind: 'MONEY_FUNNEL' } })
    expect(signal.summary).toContain('100%')
    expect(signal.evidence).toMatchObject({ total: 125_000 })
  })

  it('встречный поток той же величины сигнала не даёт', async () => {
    const one = await player('even-1')
    const two = await player('even-2')
    for (let i = 0; i < 3; i++) {
      await soldListing(one.character.id, two.character.id, 25_000)
      await soldListing(two.character.id, one.character.id, 25_000)
    }
    expect(await detectMoneyFunnel()).toBe(0)
  })

  it('сверка авторитета с журналом ловит правку мимо приложения', async () => {
    const boss = await player('ledger', 100_000)
    const clan = await ClansService.create(boss.character.id, uid('led-clan'), 'LEDG1')
    await testPrisma.clanAuthorityLog.create({
      data: { clanId: clan.id, amount: 40, reason: 'ADMIN_ADJUST', balanceAfter: 40 },
    })
    await testPrisma.clan.update({ where: { id: clan.id }, data: { authority: 40 } })
    expect(await detectLedgerMismatch()).toBe(0)

    // Кто-то поправил поле в базе, минуя приложение.
    await testPrisma.clan.update({ where: { id: clan.id }, data: { authority: 400 } })
    expect(await detectLedgerMismatch()).toBe(1)

    const signal = await testPrisma.abuseSignal.findFirstOrThrow({ where: { kind: 'DUPLICATION' } })
    // Тяжесть 3 — «остановить и разобраться», а не «забанить».
    expect(signal.severity).toBe(3)
    expect(signal.evidence).toMatchObject({ stored: 400, fromLog: 40 })
  })

  it('ограбления сверх нормы за сутки видны бригадой, а не игроком', async () => {
    const boss = await player('rob', 100_000)
    const victim = await player('rob-v', 100_000)
    const attacker = await ClansService.create(boss.character.id, uid('rob-a'), 'ROBA1')
    const defender = await ClansService.create(victim.character.id, uid('rob-d'), 'ROBD1')
    const object = await testPrisma.productionObject.create({
      data: {
        code: uid('obj'), name: 'Цех', type: 'WORKSHOP', locationId: 'industrial',
        requiredProfessionCode: 'scrap_collector', requiredProfessionLevel: 0,
        shiftDurationMinutes: 30, baseSalary: 100, baseProductionExp: 10,
      },
    })
    for (let i = 0; i < 6; i++) {
      await testPrisma.objectAttack.create({
        data: {
          objectId: object.id, attackerClanId: attacker.id, defenderClanId: defender.id,
          filedByCharacterId: boss.character.id, type: 'ROBBERY',
          moneyTaken: 8_000, authoritySpent: 25,
        },
      })
    }
    expect(await detectRobberyStreak()).toBe(1)
    const signal = await testPrisma.abuseSignal.findFirstOrThrow({ where: { kind: 'ROBBERY_STREAK' } })
    expect(signal.evidence).toMatchObject({ taken: 48_000 })
    expect(signal.severity).toBe(1)
  })

  // ── Ключ повтора ──────────────────────────────────────────

  it('один повод — один сигнал, сколько бы раз ни гонялся разбор', async () => {
    const draft = {
      kind: 'WEAK_FARMING' as const,
      severity: 1 as const,
      userIds: [],
      summary: 'проверка ключа повтора',
      evidence: {},
      dedupeKey: 'same-key',
    }
    expect(await raise(draft)).toBe(true)
    expect(await raise(draft)).toBe(false)
    expect(await testPrisma.abuseSignal.count({ where: { kind: 'WEAK_FARMING' } })).toBe(1)
  })

  // ── Рыночные махинации ────────────────────────────────────

  /** Проданный ресурсный лот с эталоном: цена сравнивается с basePrice×amount. */
  async function soldResource(sellerId: string, buyerId: string, templateId: string, price: number) {
    return testPrisma.marketListing.create({
      data: {
        sellerCharacterId: sellerId, buyerCharacterId: buyerId,
        type: 'RESOURCE', resourceTemplateId: templateId, resourceAmount: 1,
        price, listingFee: 0, status: 'SOLD', soldAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    })
  }

  it('пять сделок пары по дну коридора поднимают сигнал махинации', async () => {
    const seller = await player('mm_seller')
    const buyer = await player('mm_buyer')
    const tpl = await testPrisma.resourceTemplate.create({
      data: { code: uid('mm_res'), name: 'Тест-ресурс', category: 'PRIMARY', tier: 1, basePrice: 100, weight: 0.1 },
    })
    // Эталон = basePrice × amount = 100. Цена 10 → ×0.10, ниже дна 0.20.
    for (let i = 0; i < 5; i += 1) await soldResource(seller.character.id, buyer.character.id, tpl.id, 10)

    expect(await detectMarketManipulation()).toBe(1)
    const signal = await testPrisma.abuseSignal.findFirst({ where: { kind: 'MARKET_MANIPULATION' } })
    expect(signal?.userIds).toEqual(expect.arrayContaining([seller.user.id, buyer.user.id]))
    expect(await detectMarketManipulation()).toBe(0) // ключ повтора: второй раз молчит
  })

  it('продажи внутри коридора махинацией не считаются', async () => {
    const seller = await player('mm_ok')
    const buyer = await player('mm_ok_buyer')
    const tpl = await testPrisma.resourceTemplate.create({
      data: { code: uid('mm_res_ok'), name: 'Тест-ресурс', category: 'PRIMARY', tier: 1, basePrice: 100, weight: 0.1 },
    })
    // Цена по эталону — ×1.0, в коридоре, и шесть штук не сигнал.
    for (let i = 0; i < 6; i += 1) await soldResource(seller.character.id, buyer.character.id, tpl.id, 100)

    expect(await detectMarketManipulation()).toBe(0)
  })

  it('четыре сделки по краю — ещё ниже порога, сигнала нет', async () => {
    const seller = await player('mm_four')
    const buyer = await player('mm_four_buyer')
    const tpl = await testPrisma.resourceTemplate.create({
      data: { code: uid('mm_res_four'), name: 'Тест-ресурс', category: 'PRIMARY', tier: 1, basePrice: 100, weight: 0.1 },
    })
    for (let i = 0; i < 4; i += 1) await soldResource(seller.character.id, buyer.character.id, tpl.id, 10)

    expect(await detectMarketManipulation()).toBe(0)
  })
})
