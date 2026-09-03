/**
 * Обратимость админских действий — шаг G2 Этапа 5.
 *
 * Проверяется не «ручка отвечает 200», а три свойства, ради которых шаг
 * вообще существует:
 *   1. действие возвращает мир в прежнее состояние при откате;
 *   2. откат нельзя выполнить дважды — иначе откат выдачи денег стал бы
 *      списанием;
 *   3. откат отказывается работать, если мир изменился, — вместо того чтобы
 *      сделать вид, что вернул.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { hashPassword } from '../../shared/security/password'
import { generateJti, storeAdminSession } from '../../shared/security/jwt'
import { ClansService } from '../../modules/clans/clans.service'
import { ClaimsService } from '../../modules/territories/claims.service'
import { TERRITORIES, PREMIUM_PRODUCTS } from '../../../prisma/economy-data'
import { cleanDatabase, testPrisma, uid } from './helpers'

const REASON = 'разбор жалобы номер сорок два'

describe('админка: обратимость действий', () => {
  let app: FastifyInstance
  let token = ''
  let moderatorToken = ''

  async function admin(role: 'SUPER_ADMIN' | 'MODERATOR') {
    const username = uid(`adm-${role.toLowerCase()}`)
    const row = await testPrisma.adminUser.create({
      data: { username, passwordHash: await hashPassword('x'), role },
    })
    const jti = generateJti()
    await storeAdminSession(jti, row.id)
    return app.jwt.sign({ role: 'admin', adminRole: row.role, adminId: row.id, jti }, { expiresIn: '1h' })
  }

  const auth = (t: string) => ({ authorization: `Bearer ${t}` })

  async function player(prefix: string, money = 1_000) {
    const login = uid(prefix)
    const user = await testPrisma.user.create({
      data: { login, email: `${login}@test.local`, passwordHash: 'x' },
    })
    return testPrisma.character.create({
      data: {
        userId: user.id, nickname: login, archetype: 'WORKER',
        hpCurrent: 80, hpMax: 80, money, battleLevel: 5,
      },
    })
  }

  beforeAll(async () => {
    await testPrisma.$connect()
    app = await buildApp()
    await app.ready()
    await testPrisma.adminUser.deleteMany()
    token = await admin('SUPER_ADMIN')
    moderatorToken = await admin('MODERATOR')
  })

  beforeEach(async () => {
    await cleanDatabase()
    await testPrisma.adminActionLog.deleteMany()
    for (const { code, name, bonusCode, bonusValue } of TERRITORIES) {
      await testPrisma.territory.create({ data: { code, name, bonusCode, bonusValue } })
    }
  })

  afterAll(async () => {
    await testPrisma.adminActionLog.deleteMany()
    await testPrisma.adminUser.deleteMany()
    await app.close()
    await testPrisma.$disconnect()
  })

  // ── Причина ───────────────────────────────────────────────

  it('без причины от десяти символов действие не выполняется', async () => {
    const character = await player('reason')
    const res = await app.inject({
      method: 'POST', url: '/api/admin/characters/money', headers: auth(token),
      payload: { characterId: character.id, amount: 500, reason: 'фикс' },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ code: 'ADMIN_005' })

    // Главное: деньги не выданы. Отказ, после которого действие всё-таки
    // случилось, хуже отсутствия проверки.
    const after = await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })
    expect(after.money).toBe(1_000)
    expect(await testPrisma.adminActionLog.count()).toBe(0)
  })

  // ── Деньги ────────────────────────────────────────────────

  it('выдача денег откатывается списанием той же суммы', async () => {
    const character = await player('money')
    const grant = await app.inject({
      method: 'POST', url: '/api/admin/characters/money', headers: auth(token),
      payload: { characterId: character.id, amount: 5_000, reason: REASON },
    })
    expect(grant.statusCode).toBe(200)
    const { actionId } = grant.json<{ actionId: string }>()

    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).money).toBe(6_000)

    const rollback = await app.inject({
      method: 'POST', url: `/api/admin/actions/${actionId}/rollback`, headers: auth(token),
      payload: { reason: 'ошиблись персонажем при выдаче' },
    })
    expect(rollback.statusCode).toBe(200)
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).money).toBe(1_000)

    // Откат — тоже действие: он в журнале и ссылается на отменённое.
    const original = await testPrisma.adminActionLog.findUniqueOrThrow({ where: { id: actionId } })
    expect(original.rolledBackAt).toBeTruthy()
    const undo = await testPrisma.adminActionLog.findUniqueOrThrow({ where: { rolledBackId: actionId } })
    expect(undo.kind).toBe('ROLLBACK')
    expect(undo.reason).toBe('ошиблись персонажем при выдаче')
  })

  it('дважды откатить нельзя: иначе откат выдачи стал бы списанием', async () => {
    const character = await player('twice')
    const grant = await app.inject({
      method: 'POST', url: '/api/admin/characters/money', headers: auth(token),
      payload: { characterId: character.id, amount: 500, reason: REASON },
    })
    const { actionId } = grant.json<{ actionId: string }>()

    const first = await app.inject({
      method: 'POST', url: `/api/admin/actions/${actionId}/rollback`, headers: auth(token),
      payload: { reason: 'первый и единственный откат' },
    })
    expect(first.statusCode).toBe(200)

    const second = await app.inject({
      method: 'POST', url: `/api/admin/actions/${actionId}/rollback`, headers: auth(token),
      payload: { reason: 'вторая попытка отката подряд' },
    })
    expect(second.statusCode).toBe(409)
    expect(second.json()).toMatchObject({ code: 'ADMIN_003' })
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).money).toBe(1_000)
  })

  it('откат отказывается, если денег уже нет', async () => {
    const character = await player('spent', 0)
    const grant = await app.inject({
      method: 'POST', url: '/api/admin/characters/money', headers: auth(token),
      payload: { characterId: character.id, amount: 5_000, reason: REASON },
    })
    const { actionId } = grant.json<{ actionId: string }>()
    // Игрок потратил выданное — забирать в минус нельзя, долгов в игре нет.
    await testPrisma.character.update({ where: { id: character.id }, data: { money: 100 } })

    const rollback = await app.inject({
      method: 'POST', url: `/api/admin/actions/${actionId}/rollback`, headers: auth(token),
      payload: { reason: 'пробуем откатить потраченное' },
    })
    expect(rollback.statusCode).toBe(409)
    expect(rollback.json()).toMatchObject({ code: 'ADMIN_004' })
    // Состояние не тронуто: отказ обязан быть полным.
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).money).toBe(100)
    expect(await testPrisma.adminActionLog.count({ where: { kind: 'ROLLBACK' } })).toBe(0)
  })

  // ── Предметы ──────────────────────────────────────────────

  it('выданный предмет откатом удаляется, и это видно в его истории', async () => {
    const character = await player('item')
    const template = await testPrisma.itemTemplate.findFirstOrThrow()

    const grant = await app.inject({
      method: 'POST', url: '/api/admin/items/grant', headers: auth(token),
      payload: { characterId: character.id, templateId: template.id, reason: REASON },
    })
    expect(grant.statusCode).toBe(201)
    const { actionId, payload } = grant.json<{ actionId: string; payload: { createdItemId: string } }>()
    const itemId = payload.createdItemId
    expect(itemId).toBeTruthy()

    const rollback = await app.inject({
      method: 'POST', url: `/api/admin/actions/${actionId}/rollback`, headers: auth(token),
      payload: { reason: 'выдали не тот предмет' },
    })
    expect(rollback.statusCode).toBe(200)

    const item = await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: itemId } })
    expect(item.status).toBe('DELETED')
    const logs = await testPrisma.itemLog.findMany({ where: { itemId }, orderBy: { createdAt: 'asc' } })
    expect(logs.map(row => row.actionCode)).toEqual(['CREATED_BY_ADMIN', 'DELETED_BY_ADMIN'])
  })

  it('откат выдачи не трогает предмет, ушедший другому владельцу', async () => {
    const character = await player('owner')
    const stranger = await player('stranger')
    const template = await testPrisma.itemTemplate.findFirstOrThrow()

    const grant = await app.inject({
      method: 'POST', url: '/api/admin/items/grant', headers: auth(token),
      payload: { characterId: character.id, templateId: template.id, reason: REASON },
    })
    const { actionId, payload } = grant.json<{ actionId: string; payload: { createdItemId: string } }>()
    // Предмет продан: удалять его теперь — вредить покупателю.
    await testPrisma.itemInstance.update({
      where: { id: payload.createdItemId }, data: { ownerId: stranger.id },
    })

    const rollback = await app.inject({
      method: 'POST', url: `/api/admin/actions/${actionId}/rollback`, headers: auth(token),
      payload: { reason: 'пробуем откатить проданный предмет' },
    })
    expect(rollback.statusCode).toBe(409)
    expect(rollback.json()).toMatchObject({ code: 'ADMIN_004' })
    const item = await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: payload.createdItemId } })
    expect(item.status).toBe('NORMAL')
    expect(item.ownerId).toBe(stranger.id)
  })

  // ── Территории ────────────────────────────────────────────

  it('сброс района откатывается снимком: владелец, ступень и защита', async () => {
    const boss = await player('terr', 100_000)
    const clan = await ClansService.create(boss.id, uid('terr-clan'), 'TERR1')
    const protectedUntil = new Date(Date.now() + 3_600_000)
    await testPrisma.territory.update({
      where: { code: 'garages' },
      data: {
        ownerClanId: clan.id, status: 'CONTROLLED', controlledAt: new Date(),
        protectedUntil, upkeepTier: 2, upkeepDebt: 7_000,
      },
    })

    const reset = await app.inject({
      method: 'POST', url: '/api/admin/territories/garages/reset', headers: auth(token),
      payload: { reason: 'клан распался, район завис' },
    })
    expect(reset.statusCode).toBe(200)
    const after = await testPrisma.territory.findUniqueOrThrow({ where: { code: 'garages' } })
    expect(after.ownerClanId).toBeNull()
    expect(after.status).toBe('NEUTRAL')
    expect(after.upkeepDebt).toBe(0)

    const { actionId } = reset.json<{ actionId: string }>()
    const rollback = await app.inject({
      method: 'POST', url: `/api/admin/actions/${actionId}/rollback`, headers: auth(token),
      payload: { reason: 'сбросили не тот район' },
    })
    expect(rollback.statusCode).toBe(200)

    const restored = await testPrisma.territory.findUniqueOrThrow({ where: { code: 'garages' } })
    expect(restored.ownerClanId).toBe(clan.id)
    expect(restored.status).toBe('CONTROLLED')
    expect(restored.upkeepTier).toBe(2)
    expect(restored.upkeepDebt).toBe(7_000)
    expect(restored.protectedUntil?.getTime()).toBe(protectedUntil.getTime())
  })

  it('район в бою не сбрасывается: бой закончился бы в никуда', async () => {
    const boss = await player('battle', 100_000)
    const clan = await ClansService.create(boss.id, uid('bat-clan'), 'BATL1')
    const territory = await testPrisma.territory.update({
      where: { code: 'market' },
      data: { ownerClanId: clan.id, status: 'UNDER_ATTACK', controlledAt: new Date() },
    })
    await testPrisma.territoryClaim.create({
      data: {
        territoryId: territory.id, attackerClanId: clan.id,
        filedByCharacterId: boss.id, battleStartsAt: new Date(),
        feePaid: 10_000, authoritySpent: 20, status: 'BATTLE',
      },
    })

    const res = await app.inject({
      method: 'POST', url: '/api/admin/territories/market/reset', headers: auth(token),
      payload: { reason: 'пробуем сбросить район в бою' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ code: 'ADMIN_007' })
  })

  // ── Авторитет ─────────────────────────────────────────────

  it('правка авторитета обратима и оставляет след в журнале бригады', async () => {
    const boss = await player('auth', 100_000)
    const clan = await ClansService.create(boss.id, uid('auth-clan'), 'AUTH1')
    await testPrisma.clan.update({ where: { id: clan.id }, data: { authority: 50 } })
    await testPrisma.clanAuthorityLog.create({
      data: { clanId: clan.id, amount: 50, reason: 'ADMIN_ADJUST', balanceAfter: 50 },
    })

    const adjust = await app.inject({
      method: 'POST', url: `/api/admin/clans/${clan.id}/authority`, headers: auth(token),
      payload: { amount: 30, reason: 'компенсация за дефект войны' },
    })
    expect(adjust.statusCode).toBe(200)
    expect((await testPrisma.clan.findUniqueOrThrow({ where: { id: clan.id } })).authority).toBe(80)

    const { actionId } = adjust.json<{ actionId: string }>()
    await app.inject({
      method: 'POST', url: `/api/admin/actions/${actionId}/rollback`, headers: auth(token),
      payload: { reason: 'компенсация оказалась лишней' },
    })
    expect((await testPrisma.clan.findUniqueOrThrow({ where: { id: clan.id } })).authority).toBe(50)

    // Обе правки в журнале бригады: и начисление, и его отмена.
    const log = await testPrisma.clanAuthorityLog.findMany({
      where: { clanId: clan.id, reason: 'ADMIN_ADJUST' }, orderBy: { createdAt: 'asc' },
    })
    expect(log.map(row => row.amount)).toEqual([50, 30, -30])
  })

  // ── Подписка ──────────────────────────────────────────────

  it('выдача подписки откатывается к прежнему сроку, покупка снимается', async () => {
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

    const grant = await app.inject({
      method: 'POST', url: '/api/admin/premium/grant', headers: auth(token),
      payload: { characterId: character.id, productCode: 'prem_sub_30', reason: 'оплата пришла на карту' },
    })
    expect(grant.statusCode).toBe(200)
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).isPremium).toBe(true)
    expect(await testPrisma.premiumPurchase.count({ where: { characterId: character.id } })).toBe(1)

    const { actionId } = grant.json<{ actionId: string }>()
    const rollback = await app.inject({
      method: 'POST', url: `/api/admin/actions/${actionId}/rollback`, headers: auth(token),
      payload: { reason: 'платёж отменён банком' },
    })
    expect(rollback.statusCode).toBe(200)

    const after = await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })
    expect(after.isPremium).toBe(false)
    expect(after.premiumExpiresAt).toBeNull()
    // История не должна показывать купленное, чего в итоге не случилось.
    expect(await testPrisma.premiumPurchase.count({ where: { characterId: character.id } })).toBe(0)
  })

  // ── Заявки ────────────────────────────────────────────────

  it('гашение заявки обратимо, потому что деньги не двигались', async () => {
    const boss = await player('claim', 100_000)
    const clan = await ClansService.create(boss.id, uid('claim-clan'), 'CLM1')
    const role = await testPrisma.clanRole.findFirstOrThrow({ where: { clanId: clan.id, code: 'fighter' } })
    const roster = [boss.id]
    for (let i = 0; i < 4; i++) {
      const mate = await player(`claim-m${i}`)
      await testPrisma.clanMember.create({
        data: { clanId: clan.id, characterId: mate.id, roleId: role.id },
      })
      roster.push(mate.id)
    }
    await testPrisma.clan.update({ where: { id: clan.id }, data: { treasury: 100_000, authority: 100 } })
    await testPrisma.clanAuthorityLog.create({
      data: { clanId: clan.id, amount: 100, reason: 'ADMIN_ADJUST', balanceAfter: 100 },
    })
    const filed = await ClaimsService.file(boss.id, 'center', roster)

    const expire = await app.inject({
      method: 'POST', url: `/api/admin/claims/${filed.claimId}/expire`, headers: auth(token),
      payload: { reason: 'заявка подана с нарушением правил' },
    })
    expect(expire.statusCode).toBe(200)
    let claim = await testPrisma.territoryClaim.findUniqueOrThrow({ where: { id: filed.claimId } })
    expect(claim.status).toBe('EXPIRED')
    // Взнос не возвращается: возврат — единственное, чего у админа нет.
    expect((await testPrisma.clan.findUniqueOrThrow({ where: { id: clan.id } })).treasury).toBe(90_000)

    const { actionId } = expire.json<{ actionId: string }>()
    const rollback = await app.inject({
      method: 'POST', url: `/api/admin/actions/${actionId}/rollback`, headers: auth(token),
      payload: { reason: 'разобрались, нарушения не было' },
    })
    expect(rollback.statusCode).toBe(200)
    claim = await testPrisma.territoryClaim.findUniqueOrThrow({ where: { id: filed.claimId } })
    expect(claim.status).toBe('PENDING')
    expect((await testPrisma.territory.findUniqueOrThrow({ where: { code: 'center' } })).status).toBe('CONTESTED')
  })

  // ── Цепочка транзакций ────────────────────────────────────

  it('цепочка по персонажу связывает деньги с админским действием', async () => {
    const character = await player('trace')
    const grant = await app.inject({
      method: 'POST', url: '/api/admin/characters/money', headers: auth(token),
      payload: { characterId: character.id, amount: 777, reason: 'компенсация за потерянный предмет' },
    })
    const { actionId } = grant.json<{ actionId: string }>()

    const res = await app.inject({
      method: 'GET', url: `/api/admin/trace?type=character&id=${character.id}`, headers: auth(token),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{
      subject: { label: string; money: number }
      events: Array<{ source: string; action: string; amount: number | null; adminActionId: string | null }>
    }>()
    expect(body.subject.money).toBe(1_777)

    // Денежная строка знает, каким админским действием она порождена, — без
    // этого журналы остаются шестью несвязанными таблицами.
    const money = body.events.find(event => event.source === 'CURRENCY')
    expect(money?.amount).toBe(777)
    expect(money?.adminActionId).toBe(actionId)

    // И само действие в той же ленте, с причиной.
    const adminEvent = body.events.find(event => event.source === 'ADMIN')
    expect(adminEvent?.action).toBe('GRANT_MONEY')
    expect(adminEvent?.adminActionId).toBe(actionId)
  })

  it('цепочка по несуществующему предмету — 404 с понятным кодом', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/trace?type=item&id=00000000-0000-4000-8000-000000000000',
      headers: auth(token),
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ code: 'ADMIN_006' })
  })

  // ── Права ─────────────────────────────────────────────────

  it('модератор не откатывает чужие действия и не трогает деньги', async () => {
    const character = await player('rights')
    const grant = await app.inject({
      method: 'POST', url: '/api/admin/characters/money', headers: auth(token),
      payload: { characterId: character.id, amount: 100, reason: REASON },
    })
    const { actionId } = grant.json<{ actionId: string }>()

    const money = await app.inject({
      method: 'POST', url: '/api/admin/characters/money', headers: auth(moderatorToken),
      payload: { characterId: character.id, amount: 100, reason: REASON },
    })
    expect(money.statusCode).toBe(403)

    const rollback = await app.inject({
      method: 'POST', url: `/api/admin/actions/${actionId}/rollback`, headers: auth(moderatorToken),
      payload: { reason: 'модератор пробует откатить' },
    })
    expect(rollback.statusCode).toBe(403)
  })

  it('лента действий фильтруется по цели', async () => {
    const one = await player('feed1')
    const two = await player('feed2')
    for (const character of [one, two, one]) {
      await app.inject({
        method: 'POST', url: '/api/admin/characters/money', headers: auth(token),
        payload: { characterId: character.id, amount: 10, reason: REASON },
      })
    }
    const res = await app.inject({
      method: 'GET', url: `/api/admin/actions?targetType=character&targetId=${one.id}`, headers: auth(token),
    })
    const body = res.json<{ items: Array<{ targetId: string }> }>()
    expect(body.items).toHaveLength(2)
    expect(body.items.every(item => item.targetId === one.id)).toBe(true)
  })
})
