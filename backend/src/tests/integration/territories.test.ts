import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ClansService } from '../../modules/clans/clans.service'
import { TerritoriesService } from '../../modules/territories/territories.service'
import { runClanMaintenance, clanUpkeepPreview, syncTiers } from '../../workers/clan-maintenance.worker'
import { TERRITORIES } from '../../../prisma/economy-data'
import { cleanDatabase, testPrisma, uid } from './helpers'

const DAY_MS = 24 * 3_600_000

async function player(prefix: string, money = 100_000, battleLevel = 5) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money, battleLevel },
  })
}

async function clanWithBoss(prefix = 'terr') {
  const boss = await player(prefix)
  const clan = await ClansService.create(boss.id, uid(`${prefix}-clan`), Math.random().toString(36).slice(2, 6).toUpperCase())
  return { boss, clan }
}

/** Сид территорий: те же шесть, что и в бою. */
async function seedTerritories() {
  for (const { code, name, bonusCode, bonusValue } of TERRITORIES) {
    await testPrisma.territory.create({ data: { code, name, bonusCode, bonusValue } })
  }
}

async function giveTerritory(code: string, clanId: string, controlledAt: Date) {
  return testPrisma.territory.update({
    where: { code },
    data: { ownerClanId: clanId, status: 'CONTROLLED', controlledAt },
  })
}

describe('территории', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => { await cleanDatabase(); await seedTerritories() })
  afterAll(async () => testPrisma.$disconnect())

  it('карта показывает шесть районов и число объектов в каждом', async () => {
    const me = await player('viewer')
    await testPrisma.productionObject.create({
      data: {
        code: uid('obj'), name: 'Цех', type: 'WORKSHOP', locationId: 'industrial',
        requiredProfessionCode: 'scrap_collector', requiredProfessionLevel: 0,
        shiftDurationMinutes: 30, baseSalary: 100, baseProductionExp: 10,
      },
    })
    const map = await TerritoriesService.list(me.id)
    expect(map.items).toHaveLength(6)
    expect(map.items.find(t => t.code === 'industrial')?.objectCount).toBe(1)
    expect(map.items.every(t => t.status === 'NEUTRAL')).toBe(true)
    expect(map.items.every(t => t.bonus.text.length > 0)).toBe(true)
  })

  it('чужой долг в карточке не виден, свой виден', async () => {
    const { boss, clan } = await clanWithBoss()
    const stranger = await player('stranger')
    await giveTerritory('center', clan.id, new Date())
    await testPrisma.territory.update({ where: { code: 'center' }, data: { upkeepDebt: 4000 } })

    const mine = await TerritoriesService.get('center', boss.id)
    expect(mine.isMine).toBe(true)
    expect(mine.upkeep?.debt).toBe(4000)

    // Чужой долг — сигнал «пора нападать», поэтому наружу не отдаётся.
    const theirs = await TerritoriesService.get('center', stranger.id)
    expect(theirs.isMine).toBe(false)
    expect(theirs.upkeep).toBeNull()
  })

  it('бонусы клана собираются только с его контролируемых районов', async () => {
    const { boss, clan } = await clanWithBoss()
    await giveTerritory('industrial', clan.id, new Date())
    const bonuses = await TerritoriesService.bonusesForCharacter(boss.id)
    expect(bonuses.CYCLE_SPEED).toBe(0.15)
    expect(bonuses.REPAIR_COST).toBeUndefined()
  })

  it('игрок без клана бонусов не получает', async () => {
    const solo = await player('solo')
    expect(await TerritoriesService.bonusesForCharacter(solo.id)).toEqual({})
  })

  it('район под долгом бонуса не даёт', async () => {
    const { boss, clan } = await clanWithBoss()
    await giveTerritory('industrial', clan.id, new Date())
    await testPrisma.territory.update({ where: { code: 'industrial' }, data: { upkeepDebt: 10_000 } })
    expect(await TerritoriesService.bonusesForCharacter(boss.id)).toEqual({})
  })

  it('сводка клана считает содержание по ступеням', async () => {
    const { boss, clan } = await clanWithBoss()
    const now = Date.now()
    await giveTerritory('center', clan.id, new Date(now - 2 * DAY_MS))
    await giveTerritory('garages', clan.id, new Date(now - DAY_MS))

    const summary = await TerritoriesService.listForClan(clan.id, boss.id)
    expect(summary.items).toHaveLength(2)
    expect(summary.items.find(t => t.code === 'center')?.tier).toBe(1)
    expect(summary.items.find(t => t.code === 'garages')?.tier).toBe(2)
    expect(summary.upkeepPerDay).toBe(7000)
  })

  it('чужую сводку клана посмотреть нельзя', async () => {
    const { clan } = await clanWithBoss()
    const stranger = await player('nosy')
    await expect(TerritoriesService.listForClan(clan.id, stranger.id)).rejects.toThrow()
  })

  it('содержание списывается одним платежом за клан и его территории', async () => {
    const { clan } = await clanWithBoss()
    await giveTerritory('center', clan.id, new Date())
    await testPrisma.clan.update({
      where: { id: clan.id },
      data: { treasury: 50_000, lastChargedAt: new Date(Date.now() - DAY_MS - 1000) },
    })

    expect(await clanUpkeepPreview(clan.id)).toBe(2500)
    await runClanMaintenance()

    const after = await testPrisma.clan.findUniqueOrThrow({ where: { id: clan.id } })
    expect(after.treasury).toBe(47_500)
    const logs = await testPrisma.clanTreasuryLog.findMany({ where: { clanId: clan.id, reason: 'MAINTENANCE' } })
    expect(logs).toHaveLength(1)
    expect(logs[0].amount).toBe(-2500)
  })

  it('Спальный район удешевляет содержание всего клана', async () => {
    const { clan } = await clanWithBoss()
    await giveTerritory('center', clan.id, new Date(Date.now() - 2 * DAY_MS))
    await giveTerritory('suburb', clan.id, new Date(Date.now() - DAY_MS))
    // 500 + 2000 + 5000 = 7500, минус четверть = 5625
    expect(await clanUpkeepPreview(clan.id)).toBe(5625)
  })

  it('остаток часов не прощается: lastChargedAt двигается на списанные сутки', async () => {
    // Дефект Этапа 3: поле двигалось на now, и лишние часы сгорали.
    // За двое суток с четвертью списывается двое суток, четверть остаётся.
    const { clan } = await clanWithBoss()
    const started = new Date(Date.now() - 2 * DAY_MS - 6 * 3_600_000)
    await testPrisma.clan.update({ where: { id: clan.id }, data: { treasury: 50_000, lastChargedAt: started } })

    await runClanMaintenance()

    const after = await testPrisma.clan.findUniqueOrThrow({ where: { id: clan.id } })
    expect(after.treasury).toBe(49_000) // 2 суток по 500
    expect(after.lastChargedAt.getTime()).toBe(started.getTime() + 2 * DAY_MS)
  })

  it('пустой общак копит долг, а не отбирает район сразу', async () => {
    const { clan } = await clanWithBoss()
    await giveTerritory('center', clan.id, new Date())
    await testPrisma.clan.update({
      where: { id: clan.id },
      data: { treasury: 0, lastChargedAt: new Date(Date.now() - DAY_MS - 1000) },
    })

    await runClanMaintenance()

    const territory = await testPrisma.territory.findUniqueOrThrow({ where: { code: 'center' } })
    expect(territory.status).toBe('CONTROLLED')
    expect(territory.upkeepDebt).toBeGreaterThan(0)
  })

  it('долг сверх порога отпускает район и списывается вместе с ним', async () => {
    const { clan } = await clanWithBoss()
    await giveTerritory('center', clan.id, new Date())
    await testPrisma.territory.update({ where: { code: 'center' }, data: { upkeepDebt: 24_000 } })
    await testPrisma.clan.update({
      where: { id: clan.id },
      data: { treasury: 0, lastChargedAt: new Date(Date.now() - DAY_MS - 1000) },
    })

    await runClanMaintenance()

    const territory = await testPrisma.territory.findUniqueOrThrow({ where: { code: 'center' } })
    expect(territory.status).toBe('NEUTRAL')
    expect(territory.ownerClanId).toBeNull()
    // Клан не должен платить за то, чем уже не владеет.
    expect(territory.upkeepDebt).toBe(0)
  })

  it('ступени пересчитываются после потери первой территории', async () => {
    const { clan } = await clanWithBoss()
    const now = Date.now()
    await giveTerritory('center', clan.id, new Date(now - 2 * DAY_MS))
    await giveTerritory('garages', clan.id, new Date(now - DAY_MS))
    await syncTiers(clan.id)
    expect((await testPrisma.territory.findUniqueOrThrow({ where: { code: 'garages' } })).upkeepTier).toBe(2)

    await testPrisma.territory.update({
      where: { code: 'center' },
      data: { status: 'NEUTRAL', ownerClanId: null, controlledAt: null },
    })
    await syncTiers(clan.id)
    expect((await testPrisma.territory.findUniqueOrThrow({ where: { code: 'garages' } })).upkeepTier).toBe(1)
  })

  it('несуществующий район — 404, а не пустой ответ', async () => {
    const me = await player('lost')
    await expect(TerritoriesService.get('atlantis', me.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})
