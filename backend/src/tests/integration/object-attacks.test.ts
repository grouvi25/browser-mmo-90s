import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ClansService } from '../../modules/clans/clans.service'
import { ObjectAttacksService } from '../../modules/territories/object-attacks.service'
import { ClanOwnershipService, clanObjectLimit } from '../../modules/production/ownership.service'
import { AuthorityService, AUTHORITY_COSTS } from '../../modules/territories/authority.service'
import { BalanceConfig } from '../../config/balance.config'
import { TERRITORIES } from '../../../prisma/economy-data'
import { cleanDatabase, testPrisma, uid } from './helpers'

const O = BalanceConfig.strategy.objectAttack

async function player(prefix: string, battleLevel = 5) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money: 100_000, battleLevel },
  })
}

async function clanWith(prefix: string, authority = 100) {
  const boss = await player(prefix)
  const clan = await ClansService.create(boss.id, uid(`${prefix}-clan`), Math.random().toString(36).slice(2, 6).toUpperCase())
  await testPrisma.clan.update({ where: { id: clan.id }, data: { treasury: 100_000, authority } })
  await testPrisma.clanAuthorityLog.create({
    data: { clanId: clan.id, amount: authority, reason: 'ADMIN_ADJUST', balanceAfter: authority },
  })
  return { boss, clan }
}

async function objectOf(ownerCharacterId: string | null, opts: {
  district?: string; balance?: number; clanId?: string
} = {}) {
  return testPrisma.productionObject.create({
    data: {
      code: uid('obj'), name: 'Цех', type: 'WORKSHOP',
      locationId: opts.district ?? 'industrial',
      requiredProfessionCode: 'scrap_collector', requiredProfessionLevel: 0,
      shiftDurationMinutes: 30, baseSalary: 100, baseProductionExp: 10,
      balance: opts.balance ?? 0,
      ownerType: opts.clanId ? 'CLAN' : ownerCharacterId ? 'PRIVATE' : 'SYSTEM',
      ownerCharacterId: opts.clanId ? null : ownerCharacterId,
      ownerClanId: opts.clanId ?? null,
      durabilityCurrent: 100, durabilityMax: 100,
    },
  })
}

/**
 * Объявить вражду и дать обороне район, в котором стоит объект.
 * Без района атака невозможна: у войны есть география, и территория
 * гейтит, где вообще можно воевать.
 */
async function declareWar(a: string, b: string, district = 'industrial') {
  await testPrisma.clanRelation.create({ data: { fromClanId: a, toClanId: b, type: 'HOSTILITY' } })
  await testPrisma.territory.update({
    where: { code: district },
    data: { ownerClanId: b, status: 'CONTROLLED', controlledAt: new Date() },
  })
}

async function seedTerritories() {
  for (const { code, name, bonusCode, bonusValue } of TERRITORIES) {
    await testPrisma.territory.create({ data: { code, name, bonusCode, bonusValue } })
  }
}

describe('бои за объекты', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => { await cleanDatabase(); await seedTerritories() })
  afterAll(async () => testPrisma.$disconnect())

  it('диверсия портит объект и списывает авторитет', async () => {
    const attacker = await clanWith('sab-a')
    const holder = await clanWith('sab-b')
    const victim = await player('victim')
    const role = await testPrisma.clanRole.findFirstOrThrow({ where: { clanId: holder.clan.id, code: 'fighter' } })
    await testPrisma.clanMember.create({ data: { clanId: holder.clan.id, characterId: victim.id, roleId: role.id } })
    const object = await objectOf(victim.id)
    await declareWar(attacker.clan.id, holder.clan.id)

    const result = await ObjectAttacksService.sabotage(attacker.boss.id, object.id)

    expect(result.durabilityLost).toBe(O.sabotageDurabilityLoss)
    expect(result.status).toBe('DAMAGED')
    const after = await testPrisma.productionObject.findUniqueOrThrow({ where: { id: object.id } })
    expect(after.durabilityCurrent).toBe(100 - O.sabotageDurabilityLoss)
    const clan = await testPrisma.clan.findUniqueOrThrow({ where: { id: attacker.clan.id } })
    expect(clan.authority).toBe(100 - AUTHORITY_COSTS.sabotage)
    expect((await AuthorityService.audit(attacker.clan.id)).matches).toBe(true)
    // Диверсия не приносит денег: это чистое отрицание.
    expect(clan.treasury).toBe(100_000)
  })

  it('ограбление снимает пятую часть баланса, но не больше потолка', async () => {
    const attacker = await clanWith('rob-a')
    const holder = await clanWith('rob-b')
    await declareWar(attacker.clan.id, holder.clan.id)
    const object = await objectOf(null, { balance: 100_000, clanId: holder.clan.id })

    const result = await ObjectAttacksService.rob(attacker.boss.id, object.id)

    // 20% от 100 000 = 20 000, но потолок 8 000.
    expect(result.moneyTaken).toBe(O.robberyCap)
    const after = await testPrisma.productionObject.findUniqueOrThrow({ where: { id: object.id } })
    expect(after.balance).toBe(100_000 - O.robberyCap)
    expect(result.treasuryAfter).toBe(100_000 + O.robberyCap)
  })

  it('под потолком берётся именно доля, а не потолок', async () => {
    const attacker = await clanWith('share-a')
    const holder = await clanWith('share-b')
    await declareWar(attacker.clan.id, holder.clan.id)
    const object = await objectOf(null, { balance: 20_000, clanId: holder.clan.id })
    const result = await ObjectAttacksService.rob(attacker.boss.id, object.id)
    expect(result.moneyTaken).toBe(4_000)
  })

  it('нищий объект не грабят', async () => {
    const attacker = await clanWith('poor-a')
    const holder = await clanWith('poor-b')
    await declareWar(attacker.clan.id, holder.clan.id)
    const object = await objectOf(null, { balance: O.robberyMinBalance - 1, clanId: holder.clan.id })
    await expect(ObjectAttacksService.rob(attacker.boss.id, object.id))
      .rejects.toMatchObject({ code: 'WAR_023' })
  })

  it('объект одиночки не атакуют вообще', async () => {
    const attacker = await clanWith('solo-a')
    const loner = await player('loner')
    const object = await objectOf(loner.id)
    await expect(ObjectAttacksService.sabotage(attacker.boss.id, object.id))
      .rejects.toMatchObject({ code: 'WAR_022' })
  })

  it('без вражды и без спорного района атаковать нельзя', async () => {
    const attacker = await clanWith('peace-a')
    const holder = await clanWith('peace-b')
    const object = await objectOf(null, { balance: 50_000, clanId: holder.clan.id })
    await expect(ObjectAttacksService.sabotage(attacker.boss.id, object.id))
      .rejects.toMatchObject({ code: 'WAR_021' })
  })

  it('свой объект не атакуют', async () => {
    const attacker = await clanWith('own-a')
    const object = await objectOf(null, { balance: 50_000, clanId: attacker.clan.id })
    await expect(ObjectAttacksService.sabotage(attacker.boss.id, object.id))
      .rejects.toMatchObject({ code: 'WAR_024' })
  })

  it('кулдаун: второй раз за трое суток объект не тронуть', async () => {
    const attacker = await clanWith('cd-a')
    const holder = await clanWith('cd-b')
    await declareWar(attacker.clan.id, holder.clan.id)
    const object = await objectOf(null, { balance: 50_000, clanId: holder.clan.id })
    await ObjectAttacksService.sabotage(attacker.boss.id, object.id)
    await expect(ObjectAttacksService.rob(attacker.boss.id, object.id))
      .rejects.toMatchObject({ code: 'WAR_020' })
  })

  it('диверсия отменяет цикл и снимает резерв сырья, а не сжигает его', async () => {
    const attacker = await clanWith('cyc-a')
    const holder = await clanWith('cyc-b')
    await declareWar(attacker.clan.id, holder.clan.id)
    const object = await objectOf(null, { clanId: holder.clan.id })
    const resource = await testPrisma.resourceTemplate.create({
      data: { code: uid('res'), name: 'Лом', category: 'PRIMARY', tier: 1, basePrice: 10, weight: 1 },
    })
    const stockRow = await testPrisma.productionObjectInventory.create({
      data: {
        productionObjectId: object.id, resourceCode: resource.code,
        quality: 'NORMAL', amount: 10, reservedAmount: 4,
      },
    })
    const recipe = await testPrisma.productionRecipe.create({
      data: {
        code: uid('rcp'), name: 'Штамповка', productionObjectCode: object.code,
        outputResourceCode: resource.code, outputAmount: 1, cycleMinutes: 60,
        laborRequired: 60, requiredProfessionCode: 'scrap_collector',
        requiredProfessionLevel: 0, requiredToolTier: 1,
      },
    })
    const cycle = await testPrisma.productionCycle.create({
      data: {
        productionObjectId: object.id, recipeId: recipe.id,
        status: 'RUNNING', laborRequired: 60, laborAccumulated: 60,
      },
    })
    await testPrisma.cycleInputReservation.create({
      data: {
        cycleId: cycle.id, inventoryId: stockRow.id,
        resourceCode: resource.code, quality: 'NORMAL', amount: 4,
      },
    })

    const result = await ObjectAttacksService.sabotage(attacker.boss.id, object.id)

    expect(result.cancelledCycleId).toBe(cycle.id)
    const stock = await testPrisma.productionObjectInventory.findFirstOrThrow({
      where: { productionObjectId: object.id, resourceCode: resource.code },
    })
    // Сырьё вернулось в свободный остаток: ущерб — время, а не материал.
    expect(stock.amount).toBe(10)
    expect(stock.reservedAmount).toBe(0)
    expect((await testPrisma.productionCycle.findUniqueOrThrow({ where: { id: cycle.id } })).status)
      .toBe('FAILED')
  })

  it('не хватает авторитета — объект цел', async () => {
    const attacker = await clanWith('noauth-a', 5)
    const holder = await clanWith('noauth-b')
    await declareWar(attacker.clan.id, holder.clan.id)
    const object = await objectOf(null, { balance: 50_000, clanId: holder.clan.id })
    await expect(ObjectAttacksService.sabotage(attacker.boss.id, object.id))
      .rejects.toMatchObject({ code: 'WAR_010' })
    const after = await testPrisma.productionObject.findUniqueOrThrow({ where: { id: object.id } })
    expect(after.durabilityCurrent).toBe(100)
    expect(after.status).toBe('ACTIVE')
  })

  it('объект вне своего и вражьего района не атаковать', async () => {
    // Раньше список говорил «атаковать нечего», а мутация всё равно
    // проходила: география проверялась только в списке.
    const attacker = await clanWith('geo-a')
    const holder = await clanWith('geo-b')
    await testPrisma.clanRelation.create({
      data: { fromClanId: attacker.clan.id, toClanId: holder.clan.id, type: 'HOSTILITY' },
    })
    const object = await objectOf(null, { balance: 50_000, clanId: holder.clan.id, district: 'suburb' })
    await expect(ObjectAttacksService.rob(attacker.boss.id, object.id))
      .rejects.toMatchObject({ code: 'WAR_025' })
  })

  it('список и сама атака согласны между собой', async () => {
    const attacker = await clanWith('sync-a')
    const holder = await clanWith('sync-b')
    await declareWar(attacker.clan.id, holder.clan.id)
    const object = await objectOf(null, { balance: 50_000, clanId: holder.clan.id })

    const list = await ObjectAttacksService.attackable(attacker.boss.id)
    const row = list.items.find(item => item.objectId === object.id)
    expect(row?.canRob).toBe(true)
    await expect(ObjectAttacksService.rob(attacker.boss.id, object.id)).resolves.toBeTruthy()
  })

  it('история атак видна', async () => {
    const attacker = await clanWith('hist-a')
    const holder = await clanWith('hist-b')
    await declareWar(attacker.clan.id, holder.clan.id)
    const object = await objectOf(null, { balance: 50_000, clanId: holder.clan.id })
    await ObjectAttacksService.sabotage(attacker.boss.id, object.id)
    const history = await ObjectAttacksService.history(object.id)
    expect(history.items).toHaveLength(1)
    expect(history.items[0].type).toBe('SABOTAGE')
    expect(history.items[0].attackerTag).toBe(attacker.clan.tag)
  })
})

describe('клановая собственность на объекты', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => { await cleanDatabase(); await seedTerritories() })
  afterAll(async () => testPrisma.$disconnect())

  it('лимит растёт от числа территорий', () => {
    expect(clanObjectLimit(0)).toBe(2)
    expect(clanObjectLimit(1)).toBe(4)
    expect(clanObjectLimit(2)).toBe(6)
  })

  it('перевод сливает баланс объекта в общак и меняет владельца', async () => {
    const { boss, clan } = await clanWith('tr')
    const object = await objectOf(boss.id, { balance: 12_345 })

    const result = await ClanOwnershipService.transfer(boss.id, object.id)

    expect(result.balanceMoved).toBe(12_345)
    const after = await testPrisma.productionObject.findUniqueOrThrow({ where: { id: object.id } })
    expect(after.ownerType).toBe('CLAN')
    expect(after.ownerClanId).toBe(clan.id)
    expect(after.ownerCharacterId).toBeNull()
    expect(after.balance).toBe(0)
    expect((await testPrisma.clan.findUniqueOrThrow({ where: { id: clan.id } })).treasury)
      .toBe(100_000 + 12_345)
  })

  it('предпросмотр честно говорит, что операция необратима', async () => {
    const { boss } = await clanWith('prev')
    const object = await objectOf(boss.id, { balance: 500 })
    const preview = await ClanOwnershipService.preview(boss.id, object.id)
    expect(preview.irreversible).toBe(true)
    expect(preview.canTransfer).toBe(true)
    expect(preview.balanceMovedToTreasury).toBe(500)
  })

  it('чужой объект не перевести', async () => {
    const { boss } = await clanWith('foreign')
    const stranger = await player('stranger')
    const object = await objectOf(stranger.id)
    await expect(ClanOwnershipService.transfer(boss.id, object.id))
      .rejects.toMatchObject({ code: 'PROD_008' })
  })

  it('повреждённый объект клану не сдать', async () => {
    const { boss } = await clanWith('dmg')
    const object = await objectOf(boss.id)
    await testPrisma.productionObject.update({ where: { id: object.id }, data: { status: 'DAMAGED' } })
    await expect(ClanOwnershipService.transfer(boss.id, object.id))
      .rejects.toMatchObject({ code: 'WAR_033' })
  })

  it('без территорий больше двух объектов клану не отдать', async () => {
    const { boss, clan } = await clanWith('limit')
    for (let i = 0; i < 2; i++) await objectOf(null, { clanId: clan.id })
    const mine = await objectOf(boss.id)
    await expect(ClanOwnershipService.transfer(boss.id, mine.id))
      .rejects.toMatchObject({ code: 'WAR_032' })
  })

  it('территория поднимает предел, и объект проходит', async () => {
    const { boss, clan } = await clanWith('grow')
    for (let i = 0; i < 2; i++) await objectOf(null, { clanId: clan.id })
    await testPrisma.territory.update({
      where: { code: 'center' },
      data: { ownerClanId: clan.id, status: 'CONTROLLED', controlledAt: new Date() },
    })
    const mine = await objectOf(boss.id)
    const result = await ClanOwnershipService.transfer(boss.id, mine.id)
    expect(result.limit).toBe(4)
  })
})
