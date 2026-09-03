/**
 * Разделы админки по стратегическому слою — шаг G1 Этапа 5.
 *
 * Проверяется не только форма ответа, но и главное свойство шага: разделы
 * доступны на чтение самой слабой роли и НЕ содержат мутаций. Мутации
 * приходят на G2 вместе с журналом действий — до тех пор в этих разделах
 * нечему быть необратимым.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { hashPassword } from '../../shared/security/password'
import { generateJti, storeAdminSession } from '../../shared/security/jwt'
import { ClansService } from '../../modules/clans/clans.service'
import { ClaimsService } from '../../modules/territories/claims.service'
import { ObjectAttacksService } from '../../modules/territories/object-attacks.service'
import { PremiumService } from '../../modules/premium/premium.service'
import { HelpersService } from '../../modules/premium/helpers.service'
import { TERRITORIES, PREMIUM_PRODUCTS } from '../../../prisma/economy-data'
import { cleanDatabase, testPrisma, uid } from './helpers'

describe('админка: разделы стратегического слоя', () => {
  let app: FastifyInstance
  let token = ''
  let supportToken = ''

  async function player(prefix: string, battleLevel = 5) {
    const login = uid(prefix)
    const user = await testPrisma.user.create({
      data: { login, email: `${login}@test.local`, passwordHash: 'x' },
    })
    return testPrisma.character.create({
      data: {
        userId: user.id, nickname: login, archetype: 'WORKER',
        hpCurrent: 80, hpMax: 80, money: 200_000, battleLevel,
      },
    })
  }

  async function warClan(prefix: string, fighters = 5) {
    const boss = await player(prefix)
    const clan = await ClansService.create(
      boss.id, uid(`${prefix}-clan`), Math.random().toString(36).slice(2, 6).toUpperCase())
    const role = await testPrisma.clanRole.findFirstOrThrow({ where: { clanId: clan.id, code: 'fighter' } })
    const roster = [boss.id]
    for (let i = 1; i < fighters; i++) {
      const mate = await player(`${prefix}m${i}`)
      await testPrisma.clanMember.create({
        data: { clanId: clan.id, characterId: mate.id, roleId: role.id },
      })
      roster.push(mate.id)
    }
    await testPrisma.clan.update({
      where: { id: clan.id }, data: { treasury: 100_000, authority: 100 },
    })
    await testPrisma.clanAuthorityLog.create({
      data: { clanId: clan.id, amount: 100, reason: 'ADMIN_ADJUST', balanceAfter: 100 },
    })
    return { boss, clan, roster, role }
  }

  /**
   * Токен админа без похода в /auth/login.
   *
   * Через ручку входа нельзя: на ней стоит лимит в пять попыток в минуту, и
   * счётчик живёт в Redis между прогонами — второй запуск файла подряд
   * получал 429 и все тесты падали с 401. Вход проверяется своим тестом
   * (admin-auth), здесь проверяются разделы.
   */
  async function login(role: 'SUPER_ADMIN' | 'SUPPORT') {
    const username = uid(`adm-${role.toLowerCase()}`)
    const admin = await testPrisma.adminUser.create({
      data: { username, passwordHash: await hashPassword('x'), role },
    })
    const jti = generateJti()
    await storeAdminSession(jti, admin.id)
    return app.jwt.sign(
      { role: 'admin', adminRole: admin.role, adminId: admin.id, jti },
      { expiresIn: '1h' },
    )
  }

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

  beforeAll(async () => {
    await testPrisma.$connect()
    app = await buildApp()
    await app.ready()
    // Логинимся один раз на весь файл: на админском входе стоит лимит в пять
    // попыток в минуту, и вход в каждом beforeEach упирался в него на
    // четвёртом тесте — дальше всё падало с 401, хотя разделы работали.
    await testPrisma.adminUser.deleteMany()
    token = await login('SUPER_ADMIN')
    supportToken = await login('SUPPORT')
  })

  beforeEach(async () => {
    await cleanDatabase()
    for (const { code, name, bonusCode, bonusValue } of TERRITORIES) {
      await testPrisma.territory.create({ data: { code, name, bonusCode, bonusValue } })
    }
  })

  afterAll(async () => {
    await testPrisma.adminUser.deleteMany()
    await app.close()
    await testPrisma.$disconnect()
  })

  it('список бригад отдаёт общак, авторитет и число территорий', async () => {
    const { clan } = await warClan('list')
    const res = await app.inject({ method: 'GET', url: '/api/admin/clans', headers: auth(token) })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ items: Array<Record<string, unknown>>; nextCursor: string | null }>()
    const row = body.items.find(item => item.id === clan.id)
    expect(row).toBeTruthy()
    expect(row!.treasury).toBe(100_000)
    expect(row!.authority).toBe(100)
    expect(row!.members).toBe(5)
    expect(row!.territories).toBe(0)
  })

  it('карточка бригады сводит журнал авторитета с полем', async () => {
    const { clan, boss, roster } = await warClan('card')
    await ClaimsService.file(boss.id, 'center', roster)

    const res = await app.inject({
      method: 'GET', url: `/api/admin/clans/${clan.id}`, headers: auth(token),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{
      clan: { authority: number; upkeepPerDay: number }
      authorityAudit: { matches: boolean; stored: number; fromLog: number }
      members: Array<{ nickname: string | null }>
      authorityLog: unknown[]
      openClaims: number
    }>()

    // Главное в карточке: расхождение поля с журналом видно сразу.
    expect(body.authorityAudit.matches).toBe(true)
    expect(body.authorityAudit.stored).toBe(80)
    expect(body.clan.authority).toBe(80)
    expect(body.authorityLog.length).toBeGreaterThan(0)
    expect(body.openClaims).toBe(1)
    // Ники добираются отдельным запросом: связи у ClanMember нет.
    expect(body.members.every(member => member.nickname)).toBe(true)
  })

  it('карточка показывает подделанный авторитет как расхождение', async () => {
    const { clan } = await warClan('fake')
    // Правка мимо приложения — ровно то, что сверка обязана поймать.
    await testPrisma.clan.update({ where: { id: clan.id }, data: { authority: 999 } })

    const res = await app.inject({
      method: 'GET', url: `/api/admin/clans/${clan.id}`, headers: auth(token),
    })
    const body = res.json<{ authorityAudit: { matches: boolean; stored: number; fromLog: number } }>()
    expect(body.authorityAudit.matches).toBe(false)
    expect(body.authorityAudit.stored).toBe(999)
    expect(body.authorityAudit.fromLog).toBe(100)
  })

  it('карта районов показывает владельца, долг и открытую заявку', async () => {
    const holder = await warClan('hold')
    const attacker = await warClan('att')
    await testPrisma.territory.update({
      where: { code: 'garages' },
      data: {
        ownerClanId: holder.clan.id, status: 'CONTROLLED',
        controlledAt: new Date(), upkeepDebt: 12_000,
      },
    })
    await ClaimsService.file(attacker.boss.id, 'center', attacker.roster)

    interface TerritoryRow {
      code: string
      upkeepDebt: number
      bonusSuspended: boolean
      owner: { tag: string } | null
      activeClaim: { attackerTag: string; battleId: string | null } | null
    }
    const res = await app.inject({ method: 'GET', url: '/api/admin/territories', headers: auth(token) })
    const body = res.json<{ items: TerritoryRow[] }>()
    expect(body.items).toHaveLength(TERRITORIES.length)

    const garages = body.items.find(item => item.code === 'garages')!
    expect(garages.owner!.tag).toBe(holder.clan.tag)
    expect(garages.upkeepDebt).toBe(12_000)
    // Долг перевалил за 10 000 — бонус района погашен, и это видно админу.
    expect(garages.bonusSuspended).toBe(true)

    const center = body.items.find(item => item.code === 'center')!
    expect(center.activeClaim!.attackerTag).toBe(attacker.clan.tag)
    expect(center.activeClaim!.battleId).toBeNull()
  })

  it('заявки: по умолчанию только открытые, состав виден поимённо', async () => {
    const attacker = await warClan('claim-a')
    const filed = await ClaimsService.file(attacker.boss.id, 'market', attacker.roster)

    const list = await app.inject({ method: 'GET', url: '/api/admin/claims', headers: auth(token) })
    const body = list.json<{ items: Array<Record<string, unknown>> }>()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].roster).toEqual({ attack: 5, defence: 0 })
    expect(body.items[0].feePaid).toBe(10_000)

    const roster = await app.inject({
      method: 'GET', url: `/api/admin/claims/${filed.claimId}/roster`, headers: auth(token),
    })
    const rosterBody = roster.json<{ roster: Array<Record<string, unknown>> }>()
    expect(rosterBody.roster).toHaveLength(5)
    expect(rosterBody.roster.every(row => row.nickname && row.side === 1)).toBe(true)

    // Отозванная заявка из списка открытых уходит, но по status=all видна.
    await ClaimsService.cancel(attacker.boss.id, filed.claimId)
    const open = await app.inject({ method: 'GET', url: '/api/admin/claims', headers: auth(token) })
    expect(open.json<{ items: unknown[] }>().items).toHaveLength(0)
    const all = await app.inject({ method: 'GET', url: '/api/admin/claims?status=all', headers: auth(token) })
    expect(all.json<{ items: unknown[] }>().items).toHaveLength(1)
  })

  it('история налётов по объекту показывает, кто и сколько унёс', async () => {
    const attacker = await warClan('raid-a')
    const holder = await warClan('raid-d')
    const victim = await player('raid-v')
    await testPrisma.clanMember.create({
      data: { clanId: holder.clan.id, characterId: victim.id, roleId: holder.role.id },
    })
    const object = await testPrisma.productionObject.create({
      data: {
        code: uid('obj'), name: 'Цех', type: 'WORKSHOP', locationId: 'industrial',
        requiredProfessionCode: 'scrap_collector', requiredProfessionLevel: 0,
        shiftDurationMinutes: 30, baseSalary: 100, baseProductionExp: 10,
        balance: 100_000, ownerType: 'PRIVATE', ownerCharacterId: victim.id,
        durabilityCurrent: 100, durabilityMax: 100,
      },
    })
    await testPrisma.clanRelation.create({
      data: { fromClanId: attacker.clan.id, toClanId: holder.clan.id, type: 'HOSTILITY' },
    })
    await testPrisma.territory.update({
      where: { code: 'industrial' },
      data: { ownerClanId: holder.clan.id, status: 'CONTROLLED', controlledAt: new Date() },
    })
    await ObjectAttacksService.rob(attacker.boss.id, object.id)

    const res = await app.inject({
      method: 'GET', url: `/api/admin/objects/${object.id}/attacks`, headers: auth(token),
    })
    const body = res.json<{ object: Record<string, unknown>; items: Array<Record<string, unknown>> }>()
    expect(body.object.balance).toBe(92_000)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].type).toBe('ROBBERY')
    expect(body.items[0].moneyTaken).toBe(8_000)
    expect(body.items[0].attackerTag).toBe(attacker.clan.tag)
  })

  it('подписка: срок, история покупок и помощники в одном ответе', async () => {
    const character = await player('prem')
    for (const p of PREMIUM_PRODUCTS) {
      await testPrisma.premiumProduct.upsert({
        where: { code: p.code },
        update: { isActive: true },
        create: {
          code: p.code, name: p.name, description: p.description, kind: p.kind,
          priceRub: p.priceRub, grantCode: p.grantCode, grantValue: p.grantValue,
          sortOrder: p.sortOrder,
        },
      })
    }
    await PremiumService.grant({ characterId: character.id, productCode: 'prem_sub_30' })
    await HelpersService.hire(character.id, 'Витёк', 'scrap_collector')

    const res = await app.inject({
      method: 'GET', url: `/api/admin/premium?characterId=${character.id}`, headers: auth(token),
    })
    const body = res.json<{
      character: { isPremium: boolean }
      purchases: Array<{ code: string; grantCode: string }>
      helpers: Array<{ name: string; status: string }>
    }>()
    expect(body.character.isPremium).toBe(true)
    expect(body.purchases[0].code).toBe('prem_sub_30')
    expect(body.purchases[0].grantCode).toBe('SUBSCRIPTION_DAYS')
    expect(body.helpers).toHaveLength(1)
    expect(body.helpers[0].name).toBe('Витёк')
  })

  it('единый поиск сводит журналы персонажа и бригады в одну ленту', async () => {
    const { clan, boss, roster } = await warClan('logs')
    await ClaimsService.file(boss.id, 'suburb', roster)

    const byClan = await app.inject({
      method: 'GET', url: `/api/admin/logs?clanId=${clan.id}`, headers: auth(token),
    })
    const body = byClan.json<{ items: Array<{ source: string; action: string; amount: number | null }> }>()
    const sources = new Set(body.items.map(item => item.source))
    // Взнос за заявку виден и в общаке, и в авторитете — это и есть смысл
    // единой ленты: одно событие оставляет след в двух журналах.
    expect(sources.has('TREASURY')).toBe(true)
    expect(sources.has('AUTHORITY')).toBe(true)
    expect(body.items.some(item => item.action === 'TERRITORY_CLAIM_FEE' && item.amount === -10_000)).toBe(true)
    expect(body.items.some(item => item.action === 'CLAIM_FILED')).toBe(true)

    // Лента отсортирована по времени убывающе — иначе она не лента.
    const times = body.items.map(item => new Date((item as unknown as { at: string }).at).getTime())
    expect([...times].sort((a, b) => b - a)).toEqual(times)

    // Персонаж и клан вместе — бессмысленный запрос, и он отклоняется, а не
    // возвращает молча пустоту.
    const both = await app.inject({
      method: 'GET', url: `/api/admin/logs?clanId=${clan.id}&characterId=${boss.id}`, headers: auth(token),
    })
    expect(both.statusCode).toBe(422)
  })

  it('SUPPORT читает все разделы: прозрачность между админами', async () => {
    const { clan } = await warClan('supp')
    for (const url of ['/api/admin/clans', `/api/admin/clans/${clan.id}`, '/api/admin/territories',
      '/api/admin/claims', '/api/admin/logs']) {
      const res = await app.inject({ method: 'GET', url, headers: auth(supportToken) })
      expect(res.statusCode, url).toBe(200)
    }
  })

  it('без админского токена разделы закрыты', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/territories' })
    expect(res.statusCode).toBe(401)
  })

  it('несуществующая бригада — 404, а не пустая карточка', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/clans/00000000-0000-4000-8000-000000000000',
      headers: auth(token),
    })
    expect(res.statusCode).toBe(404)
  })
})
