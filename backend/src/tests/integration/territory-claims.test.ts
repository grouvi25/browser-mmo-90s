import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ClansService } from '../../modules/clans/clans.service'
import { ClaimsService } from '../../modules/territories/claims.service'
import { AuthorityService, AUTHORITY_COSTS, AUTHORITY_GAINS } from '../../modules/territories/authority.service'
import { runTerritoryClaims } from '../../workers/territory-claims.worker'
import { TERRITORIES } from '../../../prisma/economy-data'
import { cleanDatabase, testPrisma, uid } from './helpers'

const HOUR_MS = 3_600_000

async function player(prefix: string, battleLevel = 5) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money: 100_000, battleLevel },
  })
}

/** Клан с главарём и нужным числом бойцов, готовый воевать. */
async function warClan(prefix: string, fighters = 5, treasury = 100_000, authority = 100) {
  const boss = await player(prefix)
  const clan = await ClansService.create(boss.id, uid(`${prefix}-clan`), Math.random().toString(36).slice(2, 6).toUpperCase())
  const role = await testPrisma.clanRole.findFirstOrThrow({ where: { clanId: clan.id, code: 'fighter' } })
  const roster = [boss.id]
  for (let i = 1; i < fighters; i++) {
    const mate = await player(`${prefix}m${i}`)
    await testPrisma.clanMember.create({ data: { clanId: clan.id, characterId: mate.id, roleId: role.id } })
    roster.push(mate.id)
  }
  await testPrisma.clan.update({ where: { id: clan.id }, data: { treasury, authority } })
  await testPrisma.clanAuthorityLog.create({
    data: { clanId: clan.id, amount: authority, reason: 'ADMIN_ADJUST', balanceAfter: authority },
  })
  return { boss, clan, roster }
}

async function seedTerritories() {
  for (const { code, name, bonusCode, bonusValue } of TERRITORIES) {
    await testPrisma.territory.create({ data: { code, name, bonusCode, bonusValue } })
  }
}

describe('заявки на территорию', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => { await cleanDatabase(); await seedTerritories() })
  afterAll(async () => testPrisma.$disconnect())

  it('заявка на ничейный район списывает взнос и авторитет, район становится спорным', async () => {
    const { boss, clan, roster } = await warClan('att')
    const claim = await ClaimsService.file(boss.id, 'center', roster)

    expect(claim.feePaid).toBe(10_000)
    expect(claim.authoritySpent).toBe(AUTHORITY_COSTS.claim)

    const after = await testPrisma.clan.findUniqueOrThrow({ where: { id: clan.id } })
    expect(after.treasury).toBe(90_000)
    expect(after.authority).toBe(100 - AUTHORITY_COSTS.claim)

    const territory = await testPrisma.territory.findUniqueOrThrow({ where: { code: 'center' } })
    expect(territory.status).toBe('CONTESTED')

    // Журнал авторитета обязан сходиться с полем — тем же приёмом Этап 5
    // будет ловить дюп.
    expect((await AuthorityService.audit(clan.id)).matches).toBe(true)
  })

  it('состав меньше пяти не принимается', async () => {
    const { boss, roster } = await warClan('small')
    await expect(ClaimsService.file(boss.id, 'center', roster.slice(0, 4)))
      .rejects.toMatchObject({ code: 'WAR_002' })
  })

  it('боец ниже третьего уровня не проходит: армия альтов не годится', async () => {
    const { boss, clan, roster } = await warClan('weak')
    const alt = await player('alt', 1)
    const role = await testPrisma.clanRole.findFirstOrThrow({ where: { clanId: clan.id, code: 'fighter' } })
    await testPrisma.clanMember.create({ data: { clanId: clan.id, characterId: alt.id, roleId: role.id } })
    await expect(ClaimsService.file(boss.id, 'center', [...roster.slice(0, 4), alt.id]))
      .rejects.toMatchObject({ code: 'WAR_003' })
  })

  it('чужой боец в составе не проходит', async () => {
    const { boss, roster } = await warClan('own')
    const outsider = await player('outsider')
    await expect(ClaimsService.file(boss.id, 'center', [...roster.slice(0, 4), outsider.id]))
      .rejects.toMatchObject({ code: 'WAR_004' })
  })

  it('без права WAR заявку не подать', async () => {
    const { clan, roster } = await warClan('noperm')
    const grunt = roster[1]
    await expect(ClaimsService.file(grunt, 'center', roster))
      .rejects.toMatchObject({ code: 'WAR_001' })
    expect(clan.id).toBeTruthy()
  })

  it('две заявки на один район одновременно: вторая отклоняется', async () => {
    const first = await warClan('first')
    const second = await warClan('second')
    await ClaimsService.file(first.boss.id, 'center', first.roster)
    await expect(ClaimsService.file(second.boss.id, 'center', second.roster))
      .rejects.toMatchObject({ code: 'WAR_005' })
  })

  it('пауза клана: вторая заявка в те же сутки не проходит', async () => {
    const { boss, roster } = await warClan('cooldown')
    await ClaimsService.file(boss.id, 'center', roster)
    await expect(ClaimsService.file(boss.id, 'garages', roster))
      .rejects.toMatchObject({ code: 'WAR_007' })
  })

  it('район под защитой заявок не принимает', async () => {
    const { boss, roster } = await warClan('prot')
    await testPrisma.territory.update({
      where: { code: 'center' },
      data: { protectedUntil: new Date(Date.now() + HOUR_MS) },
    })
    await expect(ClaimsService.file(boss.id, 'center', roster))
      .rejects.toMatchObject({ code: 'WAR_006' })
  })

  it('свой район атаковать нельзя', async () => {
    const { boss, clan, roster } = await warClan('self')
    await testPrisma.territory.update({
      where: { code: 'center' },
      data: { ownerClanId: clan.id, status: 'CONTROLLED', controlledAt: new Date() },
    })
    await expect(ClaimsService.file(boss.id, 'center', roster))
      .rejects.toMatchObject({ code: 'WAR_015' })
  })

  it('союзный район атаковать нельзя', async () => {
    const attacker = await warClan('ally-a')
    const holder = await warClan('ally-b')
    await testPrisma.territory.update({
      where: { code: 'center' },
      data: { ownerClanId: holder.clan.id, status: 'CONTROLLED', controlledAt: new Date() },
    })
    await testPrisma.clanRelation.create({
      data: { fromClanId: attacker.clan.id, toClanId: holder.clan.id, type: 'ALLIANCE' },
    })
    await expect(ClaimsService.file(attacker.boss.id, 'center', attacker.roster))
      .rejects.toMatchObject({ code: 'WAR_009' })
  })

  it('лимит территорий не даёт взять третью', async () => {
    const { boss, clan, roster } = await warClan('limit')
    for (const code of ['center', 'garages']) {
      await testPrisma.territory.update({
        where: { code },
        data: { ownerClanId: clan.id, status: 'CONTROLLED', controlledAt: new Date() },
      })
    }
    await expect(ClaimsService.file(boss.id, 'market', roster))
      .rejects.toMatchObject({ code: 'WAR_008' })
  })

  it('не хватает авторитета — заявки нет и деньги целы', async () => {
    const { boss, clan, roster } = await warClan('poor', 5, 100_000, 5)
    await expect(ClaimsService.file(boss.id, 'center', roster))
      .rejects.toMatchObject({ code: 'WAR_010' })
    const after = await testPrisma.clan.findUniqueOrThrow({ where: { id: clan.id } })
    expect(after.treasury).toBe(100_000)
    expect(await testPrisma.territoryClaim.count()).toBe(0)
  })

  it('состав атакующего виден обороне с момента подачи', async () => {
    const attacker = await warClan('vis-a')
    const holder = await warClan('vis-b')
    await testPrisma.territory.update({
      where: { code: 'center' },
      data: { ownerClanId: holder.clan.id, status: 'CONTROLLED', controlledAt: new Date() },
    })
    const claim = await ClaimsService.file(attacker.boss.id, 'center', attacker.roster)
    const card = await ClaimsService.get(claim.claimId)
    expect(card.attacker.roster).toHaveLength(5)
    expect(card.defender?.clanTag).toBe(holder.clan.tag)
  })

  it('оборона выставляет состав, пока не поздно', async () => {
    const attacker = await warClan('def-a')
    const holder = await warClan('def-b')
    await testPrisma.territory.update({
      where: { code: 'center' },
      data: { ownerClanId: holder.clan.id, status: 'CONTROLLED', controlledAt: new Date() },
    })
    const claim = await ClaimsService.file(attacker.boss.id, 'center', attacker.roster)
    await ClaimsService.setDefence(holder.boss.id, claim.claimId, holder.roster)
    const card = await ClaimsService.get(claim.claimId)
    expect(card.defender?.roster).toHaveLength(5)
  })

  it('за десять минут до боя состав обороны закрыт', async () => {
    const attacker = await warClan('lock-a')
    const holder = await warClan('lock-b')
    await testPrisma.territory.update({
      where: { code: 'center' },
      data: { ownerClanId: holder.clan.id, status: 'CONTROLLED', controlledAt: new Date() },
    })
    const claim = await ClaimsService.file(attacker.boss.id, 'center', attacker.roster)
    await testPrisma.territoryClaim.update({
      where: { id: claim.claimId },
      data: { battleStartsAt: new Date(Date.now() + 5 * 60_000) },
    })
    await expect(ClaimsService.setDefence(holder.boss.id, claim.claimId, holder.roster))
      .rejects.toMatchObject({ code: 'WAR_012' })
  })

  it('отзыв возвращает авторитет, но не взнос', async () => {
    const { boss, clan, roster } = await warClan('cancel')
    const claim = await ClaimsService.file(boss.id, 'center', roster)
    const result = await ClaimsService.cancel(boss.id, claim.claimId)

    expect(result.feeRefunded).toBe(false)
    const after = await testPrisma.clan.findUniqueOrThrow({ where: { id: clan.id } })
    expect(after.treasury).toBe(90_000)
    expect(after.authority).toBe(100)
    expect((await testPrisma.territory.findUniqueOrThrow({ where: { code: 'center' } })).status).toBe('NEUTRAL')
    expect((await AuthorityService.audit(clan.id)).matches).toBe(true)
  })

  it('неявка обороны: победа без боя, но район всё равно под защитой', async () => {
    const attacker = await warClan('walk-a')
    const holder = await warClan('walk-b')
    await testPrisma.territory.update({
      where: { code: 'center' },
      data: { ownerClanId: holder.clan.id, status: 'CONTROLLED', controlledAt: new Date() },
    })
    const claim = await ClaimsService.file(attacker.boss.id, 'center', attacker.roster)
    await testPrisma.territoryClaim.update({
      where: { id: claim.claimId },
      data: { battleStartsAt: new Date(Date.now() - 1000) },
    })

    await runTerritoryClaims()

    const resolved = await testPrisma.territoryClaim.findUniqueOrThrow({ where: { id: claim.claimId } })
    expect(resolved.status).toBe('WON')
    expect(resolved.walkover).toBe(true)

    const territory = await testPrisma.territory.findUniqueOrThrow({ where: { code: 'center' } })
    expect(territory.ownerClanId).toBe(attacker.clan.id)
    expect(territory.status).toBe('CONTROLLED')
    // Безответная война не должна быть быстрее честной.
    expect(territory.protectedUntil!.getTime()).toBeGreaterThan(Date.now())
    expect(territory.upkeepDebt).toBe(0)

    const clan = await testPrisma.clan.findUniqueOrThrow({ where: { id: attacker.clan.id } })
    expect(clan.authority).toBe(100 - AUTHORITY_COSTS.claim + AUTHORITY_GAINS.territoryWon)
  })

  it('бой назначается из состава заявки, сторона в сторону', async () => {
    const attacker = await warClan('bat-a')
    const holder = await warClan('bat-b')
    await testPrisma.territory.update({
      where: { code: 'center' },
      data: { ownerClanId: holder.clan.id, status: 'CONTROLLED', controlledAt: new Date() },
    })
    const claim = await ClaimsService.file(attacker.boss.id, 'center', attacker.roster)
    await ClaimsService.setDefence(holder.boss.id, claim.claimId, holder.roster)
    await testPrisma.territoryClaim.update({
      where: { id: claim.claimId },
      data: { battleStartsAt: new Date(Date.now() - 1000) },
    })

    await runTerritoryClaims()

    const resolved = await testPrisma.territoryClaim.findUniqueOrThrow({
      where: { id: claim.claimId },
      include: { battle: { include: { participants: true } } },
    })
    expect(resolved.status).toBe('BATTLE')
    expect(resolved.battle?.type).toBe('TERRITORY')
    expect(resolved.battle?.participants.filter(p => p.side === 1)).toHaveLength(5)
    expect(resolved.battle?.participants.filter(p => p.side === 2)).toHaveLength(5)
    expect((await testPrisma.territory.findUniqueOrThrow({ where: { code: 'center' } })).status)
      .toBe('UNDER_ATTACK')
  })

  it('оборона выстояла: район остаётся, обороне идёт больше авторитета, чем дала бы атака', async () => {
    const attacker = await warClan('win-a')
    const holder = await warClan('win-b')
    await testPrisma.territory.update({
      where: { code: 'center' },
      data: { ownerClanId: holder.clan.id, status: 'CONTROLLED', controlledAt: new Date() },
    })
    const claim = await ClaimsService.file(attacker.boss.id, 'center', attacker.roster)
    await ClaimsService.setDefence(holder.boss.id, claim.claimId, holder.roster)
    await testPrisma.territoryClaim.update({
      where: { id: claim.claimId },
      data: { battleStartsAt: new Date(Date.now() - 1000) },
    })
    await runTerritoryClaims()

    const withBattle = await testPrisma.territoryClaim.findUniqueOrThrow({ where: { id: claim.claimId } })
    // Атакующие полегли, оборона стоит.
    await testPrisma.battleParticipant.updateMany({
      where: { battleId: withBattle.battleId!, side: 1 }, data: { isAlive: false },
    })
    await testPrisma.battle.update({ where: { id: withBattle.battleId! }, data: { status: 'FINISHED' } })

    await runTerritoryClaims()

    const resolved = await testPrisma.territoryClaim.findUniqueOrThrow({ where: { id: claim.claimId } })
    expect(resolved.status).toBe('LOST')
    const territory = await testPrisma.territory.findUniqueOrThrow({ where: { code: 'center' } })
    expect(territory.ownerClanId).toBe(holder.clan.id)
    expect(territory.status).toBe('CONTROLLED')

    const defender = await testPrisma.clan.findUniqueOrThrow({ where: { id: holder.clan.id } })
    expect(defender.authority).toBe(100 + AUTHORITY_GAINS.territoryDefended)
    expect(AUTHORITY_GAINS.territoryDefended).toBeGreaterThan(AUTHORITY_GAINS.territoryWon)
  })

  it('атака взяла район: контроль переходит, долг прежнего владельца списан', async () => {
    const attacker = await warClan('take-a')
    const holder = await warClan('take-b')
    await testPrisma.territory.update({
      where: { code: 'center' },
      data: {
        ownerClanId: holder.clan.id, status: 'CONTROLLED',
        controlledAt: new Date(), upkeepDebt: 7000,
      },
    })
    const claim = await ClaimsService.file(attacker.boss.id, 'center', attacker.roster)
    await ClaimsService.setDefence(holder.boss.id, claim.claimId, holder.roster)
    await testPrisma.territoryClaim.update({
      where: { id: claim.claimId }, data: { battleStartsAt: new Date(Date.now() - 1000) },
    })
    await runTerritoryClaims()

    const withBattle = await testPrisma.territoryClaim.findUniqueOrThrow({ where: { id: claim.claimId } })
    await testPrisma.battleParticipant.updateMany({
      where: { battleId: withBattle.battleId!, side: 2 }, data: { isAlive: false },
    })
    await testPrisma.battle.update({ where: { id: withBattle.battleId! }, data: { status: 'FINISHED' } })
    await runTerritoryClaims()

    const territory = await testPrisma.territory.findUniqueOrThrow({ where: { code: 'center' } })
    expect(territory.ownerClanId).toBe(attacker.clan.id)
    // Новый хозяин не платит чужой долг, а старый уже наказан потерей.
    expect(territory.upkeepDebt).toBe(0)
    expect(territory.upkeepTier).toBe(1)
  })

  it('авторитет нельзя увести в минус даже гонкой', async () => {
    const { clan } = await warClan('race', 5, 100_000, 20)
    await expect(Promise.all([
      testPrisma.$transaction(tx => AuthorityService.spend(tx, { clanId: clan.id, amount: 20, reason: 'CLAIM_FILED' })),
      testPrisma.$transaction(tx => AuthorityService.spend(tx, { clanId: clan.id, amount: 20, reason: 'CLAIM_FILED' })),
    ])).rejects.toBeTruthy()
    const after = await testPrisma.clan.findUniqueOrThrow({ where: { id: clan.id } })
    expect(after.authority).toBeGreaterThanOrEqual(0)
  })
})
