/**
 * Правки заказчика по документу от 20 октября 2026: ресурсы после смены на
 * объекте с рецептом, отдых 30 минут между сменами, второй нож во вторую
 * руку, журнал склада по 10 строк, названия вместо кодов в рецептах и
 * «что купили и за сколько» в уведомлении.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { getRedis, disconnectRedis } from '../../shared/db/redis'
import { WorkService } from '../../modules/work/work.service'
import { ClansService } from '../../modules/clans/clans.service'
import { RecipeService } from '../../modules/production/recipe.service'
import { ClaimsService } from '../../modules/territories/claims.service'
import { NOTICE_RULES } from '../../modules/chat/notices.hook'
import { runWorkShiftFinalize } from '../../workers/work-shift-finalize.worker'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function player(prefix: string) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money: 100_000, battleLevel: 5 },
  })
}

/** Объект с рецептом, как все объекты на проде: раньше смена на нём уходила
 *  целиком в цикл владельца, и работник оставался без сырья. */
async function recipeObject() {
  const resource = await testPrisma.resourceTemplate.create({ data: { code: uid('wood'), name: 'Доски', category: 'PRIMARY', tier: 1, basePrice: 8, weight: 0.5 } })
  const code = uid('obj')
  const recipe = await testPrisma.productionRecipe.create({
    data: { code: uid('rcp'), name: 'Доски', productionObjectCode: code, outputResourceCode: resource.code, outputAmount: 5, cycleMinutes: 60, laborRequired: 120, requiredProfessionCode: 'carpenter' },
  })
  const object = await testPrisma.productionObject.create({
    data: { code, name: 'Пилорама', type: 'SCRAPYARD', requiredProductionLevel: 0, requiredProfessionCode: 'carpenter', requiredProfessionLevel: 0, shiftDurationMinutes: 30, baseSalary: 80, baseProductionExp: 10, producesResourceCode: resource.code, outputAmountMin: 3, outputAmountMax: 5, activeRecipeId: recipe.id },
  })
  return { resource, object, recipe }
}

async function finishShift(characterId: string, objectId: string, key: string) {
  const started = await WorkService.start(characterId, objectId)
  await testPrisma.workShift.update({ where: { id: started.shift.id }, data: { endsAt: new Date(Date.now() - 1000) } })
  await runWorkShiftFinalize()
  return WorkService.claim(characterId, started.shift.id, key)
}

describe('правки по документу 20.10', () => {
  let app: FastifyInstance
  beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping(); app = await buildApp(); await app.ready() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })
  afterAll(async () => { await app.close(); await testPrisma.$disconnect(); await disconnectRedis() })

  it('после смены на объекте с рецептом работник получает сырьё себе', async () => {
    const worker = await player('worker')
    await testPrisma.characterProfession.create({ data: { characterId: worker.id, professionCode: 'carpenter' } })
    const { resource, object } = await recipeObject()

    const claimed = await finishShift(worker.id, object.id, 'oct21-claim-0001')

    expect(claimed.resourceReward?.code).toBe(resource.code)
    expect(claimed.resourceReward?.amount).toBeGreaterThanOrEqual(3)
    expect(claimed.resourceReward?.amount).toBeLessThanOrEqual(5)
    const stack = await testPrisma.resourceStack.findUniqueOrThrow({ where: { characterId_resourceTemplateId: { characterId: worker.id, resourceTemplateId: resource.id } } })
    expect(stack.amount).toBe(claimed.resourceReward?.amount)
  })

  it('следующую смену можно начать только через 30 минут после закрытия прошлой', async () => {
    const worker = await player('rest')
    await testPrisma.characterProfession.create({ data: { characterId: worker.id, professionCode: 'carpenter' } })
    const { object } = await recipeObject()
    const claimed = await finishShift(worker.id, object.id, 'oct21-claim-0002')

    await expect(WorkService.start(worker.id, object.id)).rejects.toMatchObject({ code: 'WORK_014', statusCode: 409 })
    // Отдых считается от конца работы, а не от того, когда смену забрали
    // (правка 24.10): работа кончилась 29 минут назад — ещё отдыхает, 31 — можно,
    // даже если смену забрали только что.
    await testPrisma.workShift.update({ where: { id: claimed.shiftId }, data: { endsAt: new Date(Date.now() - 29 * 60_000), claimedAt: new Date() } })
    await expect(WorkService.start(worker.id, object.id)).rejects.toMatchObject({ code: 'WORK_014' })
    await testPrisma.workShift.update({ where: { id: claimed.shiftId }, data: { endsAt: new Date(Date.now() - 31 * 60_000), claimedAt: new Date() } })
    expect((await WorkService.start(worker.id, object.id)).shift.status).toBe('ACTIVE')
  })

  it('второй нож без указанной руки идёт в свободную руку, а не снимает первый', async () => {
    const login = uid('knife')
    const password = 'local_test_pw_123'
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: { acceptPolicy: true, login, email: `${login}@test.local`, password } })).statusCode).toBeLessThan(300)
    const { token } = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login, password } })).json<{ token: string }>()
    const created = await app.inject({ method: 'POST', url: '/api/characters', headers: { authorization: `Bearer ${token}` }, payload: { nickname: 'Knife' + Math.random().toString(36).slice(2, 8), archetype: 'STREET' } })
    expect(created.statusCode).toBeLessThan(300)
    const character = await testPrisma.character.findFirstOrThrow({ where: { user: { login } } })
    const knife = await testPrisma.itemTemplate.create({ data: { code: uid('knife'), name: 'Нож', type: 'WEAPON', weaponType: 'KNIFE', minDamage: 2, maxDamage: 4, weight: 1, durabilityMax: 50, priceBase: 100, isEquippable: true } })
    const make = () => testPrisma.itemInstance.create({ data: { templateId: knife.id, ownerId: character.id, quality: 'COMMON', durabilityCurrent: 50, durabilityMax: 50, weight: 1, sourceType: 'GOVERNMENT' } })
    const first = await make()
    const second = await make()
    // Стартовое оружие персонажа снимаем, чтобы руки были пустыми.
    await testPrisma.itemInstance.updateMany({ where: { ownerId: character.id, isEquipped: true }, data: { isEquipped: false, status: 'NORMAL', armorSlot: null } })

    for (const item of [first, second]) {
      const res = await app.inject({ method: 'POST', url: '/api/inventory/equip', headers: { authorization: `Bearer ${token}` }, payload: { itemInstanceId: item.id } })
      expect(res.statusCode).toBe(200)
    }
    const hands = await testPrisma.itemInstance.findMany({ where: { id: { in: [first.id, second.id] } }, select: { id: true, isEquipped: true, armorSlot: true } })
    expect(hands.find(h => h.id === first.id)).toMatchObject({ isEquipped: true, armorSlot: 'LEFT_HAND' })
    expect(hands.find(h => h.id === second.id)).toMatchObject({ isEquipped: true, armorSlot: 'RIGHT_HAND' })
  })

  it('журнал склада листается по 10 строк, новые сверху', async () => {
    const boss = await player('boss')
    const clan = await ClansService.create(boss.id, uid('clan').slice(0, 30), Math.random().toString(36).slice(2, 6).toUpperCase())
    const base = Date.now()
    await testPrisma.clanStorageLog.createMany({
      data: Array.from({ length: 23 }, (_, i) => ({ clanId: clan.id, characterId: boss.id, resourceCode: 'res_greens', amount: i + 1, createdAt: new Date(base - (23 - i) * 1000) })),
    })

    const first = await ClansService.storageLog(boss.id, 1)
    expect(first).toMatchObject({ page: 1, pages: 3, total: 23 })
    expect(first.items.map(r => r.amount)).toEqual([23, 22, 21, 20, 19, 18, 17, 16, 15, 14])
    const last = await ClansService.storageLog(boss.id, 3)
    expect(last.items.map(r => r.amount)).toEqual([3, 2, 1])
    // Номер за пределами — последняя страница, а не пустая.
    expect((await ClansService.storageLog(boss.id, 99)).page).toBe(3)
  })

  it('в рецептах названия ресурсов, продукции и профессии вместо кодов', async () => {
    const worker = await player('recipes')
    const { recipe, object, resource } = await recipeObject()
    const input = await testPrisma.resourceTemplate.create({ data: { code: uid('log'), name: 'Брёвна', category: 'PRIMARY', tier: 1, basePrice: 5, weight: 1 } })
    await testPrisma.productionRecipeInput.create({ data: { recipeId: recipe.id, resourceCode: input.code, amount: 2 } })

    const [row] = await RecipeService.listForObject(object.code, worker.id)
    expect(row.inputs[0]).toMatchObject({ resourceCode: input.code, resourceName: 'Брёвна' })
    expect(row.outputName).toBe(resource.name)
    expect(row.requiredProfessionName).toBe('Столяр')
  })

  it('в уведомлении о покупке написано, что куплено и за сколько', () => {
    const rule = (url: string) => NOTICE_RULES.find(r => r.url === url)!
    expect(rule('/api/shops/government/buy').text({}, { itemName: 'Кастет', price: 1500 })).toBe('Вы купили «Кастет» за 1 500 ₽ в Госмагазине.')
    expect(rule('/api/city/shops/:kind/buy').text({}, { itemName: 'Талисман опыта', priceDollars: 30 })).toBe('Вы купили «Талисман опыта» за 30 $.')
    expect(rule('/api/private-shops/:shopCode/buy').text({}, { itemName: null, total: 300 })).toBe('Вы купили вещь за 300 ₽ в частной лавке.')
    expect(rule('/api/market/listings/:listingId/buy').text({}, { finalPrice: 900 })).toBe('Вы купили лот на рынке за 900 ₽.')
  })

  it('рядовой боец сам встаёт в заявку на район, один раз и только пока состав открыт', async () => {
    const boss = await player('warboss')
    const clan = await ClansService.create(boss.id, uid('war').slice(0, 30), Math.random().toString(36).slice(2, 6).toUpperCase())
    const fighterRole = await testPrisma.clanRole.findFirstOrThrow({ where: { clanId: clan.id, code: 'fighter' } })
    const fighter = await player('fighter')
    await testPrisma.clanMember.create({ data: { clanId: clan.id, characterId: fighter.id, roleId: fighterRole.id } })
    await testPrisma.character.update({ where: { id: fighter.id }, data: { clanId: clan.id } })
    const stranger = await player('stranger')
    const territory = await testPrisma.territory.create({ data: { code: uid('terr'), name: 'Вокзал', bonusCode: 'STORAGE_CAP', bonusValue: 0.1 } })
    const claim = await testPrisma.territoryClaim.create({
      data: { territoryId: territory.id, attackerClanId: clan.id, filedByCharacterId: boss.id, battleStartsAt: new Date(Date.now() + 60 * 60_000), feePaid: 10_000, authoritySpent: 0 },
    })
    await testPrisma.territoryClaimRoster.create({ data: { claimId: claim.id, characterId: boss.id, side: 1, battleLevel: 5 } })

    expect((await ClaimsService.get(claim.id, fighter.id)).inRoster).toBe(false)
    expect(await ClaimsService.join(fighter.id, claim.id)).toEqual({ claimId: claim.id, side: 1 })
    const view = await ClaimsService.get(claim.id, fighter.id)
    expect(view.inRoster).toBe(true)
    expect(view.attacker.roster.map(r => r.nickname)).toContain(fighter.nickname)

    await expect(ClaimsService.join(fighter.id, claim.id)).rejects.toMatchObject({ code: 'WAR_005' })
    await expect(ClaimsService.join(stranger.id, claim.id)).rejects.toMatchObject({ statusCode: 403 })
    // За 10 минут до боя состав закрыт.
    const late = await player('late')
    await testPrisma.clanMember.create({ data: { clanId: clan.id, characterId: late.id, roleId: fighterRole.id } })
    await testPrisma.territoryClaim.update({ where: { id: claim.id }, data: { battleStartsAt: new Date(Date.now() + 5 * 60_000) } })
    await expect(ClaimsService.join(late.id, claim.id)).rejects.toMatchObject({ code: 'WAR_012' })
  })
})
