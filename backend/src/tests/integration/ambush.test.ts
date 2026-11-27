import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, paidClan, testPrisma, uid } from './helpers'
import { AmbushService } from '../../modules/battles/ambush.service'
import { HospitalService } from '../../modules/battles/hospital.service'
import { ClansService } from '../../modules/clans/clans.service'
import { CityService } from '../../modules/city/city.service'
import { BattleService } from '../../modules/battles/battles.service'
import { BattleRedis, ChatRedis } from '../../shared/db/redis'

const minute = 60_000

async function player(opts: { money?: number; dollars?: number; agi?: number } = {}) {
  const id = uid('amb')
  const user = await testPrisma.user.create({ data: { login: id, email: id + '@test.local', passwordHash: 'test' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: id, archetype: 'WORKER', hpCurrent: 100, hpMax: 100, battleLevel: 5,
      money: opts.money ?? 10_000, dollars: opts.dollars ?? 0, location: '/market', lastLocation: '/market',
      stats: { create: { agi: opts.agi ?? 10 } } },
  })
  await ChatRedis.presenceTouch(character.id)
  return { user, character }
}

const state = (id: string) => testPrisma.character.findUniqueOrThrow({ where: { id } })

describe('травмы v8, этап 2: засада, реанимация, общак', () => {
  beforeAll(() => testPrisma.$connect())
  beforeEach(() => cleanDatabase())
  afterAll(() => testPrisma.$disconnect())

  type Live = { roundNumber: number; ambush?: { surprise: boolean }; participants: Array<{ characterId: string; hasActedThisRound: boolean; pendingAction?: string }> }

  it('бинокль один; засада — сразу дуэль, при удаче цель первый раунд застигнута врасплох', async () => {
    const hunter = await player()
    const victim = await player()
    await AmbushService.buyBinoculars(hunter.user.id)
    await expect(AmbushService.buyBinoculars(hunter.user.id)).rejects.toThrow('уже лежит')
    expect(await state(hunter.character.id)).toMatchObject({ money: 9200, pocketBinoculars: 1 })

    // Цель в другом месте: бинокль цел.
    await testPrisma.character.update({ where: { id: victim.character.id }, data: { location: '/shop' } })
    await expect(AmbushService.ambush(hunter.user.id, victim.character.id, new Date(), 0)).rejects.toThrow('не найдена')
    expect((await state(hunter.character.id)).pocketBinoculars).toBe(1)
    await testPrisma.character.update({ where: { id: victim.character.id }, data: { location: '/market' } })

    const result = await AmbushService.ambush(hunter.user.id, victim.character.id, new Date(), 0)
    expect(result).toMatchObject({ surprise: true, target: victim.character.nickname })
    expect(await state(hunter.character.id)).toMatchObject({ pocketBinoculars: 0, status: 'IN_BATTLE' })
    expect(await state(victim.character.id)).toMatchObject({ status: 'IN_BATTLE', injuryTier: null })
    const battle = await testPrisma.battle.findUniqueOrThrow({ where: { id: result.battleId }, include: { participants: true } })
    expect(battle).toMatchObject({ type: 'PVP_DUEL', status: 'ACTIVE' })
    expect(battle.participants).toHaveLength(2)
    expect(await testPrisma.gameNotice.count({ where: { characterId: victim.character.id, text: { contains: 'застигнуты врасплох' } } })).toBe(1)

    // Первый раунд за цель уже сыгран: стоит без ударов и блоков.
    const live = await BattleRedis.getState<Live>(result.battleId)
    expect(live!.ambush).toMatchObject({ surprise: true })
    expect(live!.participants.find(p => p.characterId === victim.character.id)).toMatchObject({ hasActedThisRound: true, pendingAction: 'surprised' })

    // Нападающий ходит — раунд закрывается, цель в журнале «застигнута врасплох».
    await BattleService.submitAction(hunter.user.id, result.battleId, {
      action: 'block', stance: 'defense4', attackZones: [], blockZones: ['HEAD', 'CHEST', 'LEFT_ARM', 'RIGHT_ARM'],
    })
    const after = await BattleRedis.getState<Live>(result.battleId)
    expect(after!.roundNumber).toBe(2)
    expect(after!.participants.every(p => !p.hasActedThisRound)).toBe(true)
    expect(await testPrisma.battleTurn.count({
      where: { battleId: result.battleId, actorCharId: victim.character.id, logLine: 'Застигнут врасплох' },
    })).toBe(1)

    // Нападающий сдаётся — он проигравший: реанимация ему, цель без травм.
    const now = Date.now()
    await BattleService.submitAction(hunter.user.id, result.battleId, { action: 'surrender' })
    const loser = await state(hunter.character.id)
    expect(loser).toMatchObject({ injuryTier: 'CRITICAL', location: '/hospital', status: 'ACTIVE' })
    expect(loser.injuryUntil!.getTime()).toBeGreaterThanOrEqual(now + 240 * minute - 5_000)
    expect(await state(victim.character.id)).toMatchObject({ injuryTier: null, status: 'ACTIVE' })
    expect(await testPrisma.gameNotice.count({ where: { characterId: victim.character.id, text: { contains: 'отбились от засады' } } })).toBe(1)
    expect(await testPrisma.battle.findUniqueOrThrow({ where: { id: result.battleId } })).toMatchObject({ status: 'FINISHED', winnerId: victim.character.id })
    expect(await CityService.location(hunter.user.id)).toMatchObject({ path: '/hospital' })
    await expect(CityService.move(hunter.user.id, '/market')).rejects.toThrow('реанимации')

    // На беспомощного не бьют.
    await testPrisma.character.update({ where: { id: victim.character.id }, data: { pocketBinoculars: 1 } })
    await expect(AmbushService.ambush(victim.user.id, hunter.character.id, new Date(), 0)).rejects.toThrow('беспомощного')
  })

  it('провал засады — бой на равных; проигравшая цель второй раз за сутки — в коме', async () => {
    const hunter = await player()
    const victim = await player()
    await testPrisma.character.update({ where: { id: hunter.character.id }, data: { pocketBinoculars: 1 } })
    await testPrisma.character.update({
      where: { id: victim.character.id }, data: { injuryCriticalAt: new Date(Date.now() - 3 * 3_600_000) },
    })
    const result = await AmbushService.ambush(hunter.user.id, victim.character.id, new Date(), 0.99)
    expect(result).toMatchObject({ surprise: false })
    const live = await BattleRedis.getState<Live>(result.battleId)
    expect(live!.participants.every(p => !p.hasActedThisRound)).toBe(true)

    // Застигнутой врасплох цель не была — сдаться может, как в любой дуэли.
    await BattleService.submitAction(victim.user.id, result.battleId, { action: 'surrender' })
    expect(await state(victim.character.id)).toMatchObject({ injuryTier: 'COMA', location: '/hospital', status: 'ACTIVE' })
    expect(await state(hunter.character.id)).toMatchObject({ injuryTier: null, status: 'ACTIVE', pocketBinoculars: 0 })
    expect(await testPrisma.gameNotice.count({ where: { characterId: hunter.character.id, text: { contains: 'Засада удалась' } } })).toBe(1)
  })

  it('застигнутая врасплох цель может сдаться в первом раунде', async () => {
    const hunter = await player()
    const victim = await player()
    await testPrisma.character.update({ where: { id: hunter.character.id }, data: { pocketBinoculars: 1 } })
    const result = await AmbushService.ambush(hunter.user.id, victim.character.id, new Date(), 0)
    await BattleService.submitAction(victim.user.id, result.battleId, { action: 'surrender' })
    expect(await state(victim.character.id)).toMatchObject({ injuryTier: 'CRITICAL', status: 'ACTIVE' })
    expect(await state(hunter.character.id)).toMatchObject({ injuryTier: null, status: 'ACTIVE' })
  })

  it('пациент сам сокращает отлёжку, ЧМЦ — один раз, ниже минимума нельзя', async () => {
    const patient = await player({ money: 10_000, dollars: 100 })
    const now = new Date()
    await testPrisma.character.update({
      where: { id: patient.character.id },
      data: { injuryTier: 'CRITICAL', injuryUntil: new Date(now.getTime() + 240 * minute), injuryCriticalAt: now },
    })
    await HospitalService.shorten(patient.user.id, 'SELF', now)
    await HospitalService.shorten(patient.user.id, 'CLINIC', now)
    expect(await state(patient.character.id)).toMatchObject({
      money: 8000, dollars: 70, injuryClinicUsed: 1, injuryUntil: new Date(now.getTime() + 60 * minute),
    })
    await expect(HospitalService.shorten(patient.user.id, 'SELF', now)).rejects.toThrow('некуда')
    await expect(HospitalService.shorten(patient.user.id, 'CLINIC', now)).rejects.toThrow('ЧМЦ')
  })

  it('общак: «Пассажиру» в долг, повтор отклоняется, взнос гасит долг и даёт авторитет', async () => {
    const boss = await player({ money: 50_000 })
    const patient = await player()
    const clan = await paidClan(boss.character.id, uid('Med'))
    await testPrisma.clan.update({ where: { id: clan.id }, data: { treasury: 5000 } })
    const role = await testPrisma.clanRole.findFirstOrThrow({ where: { clanId: clan.id, code: 'fighter' } })
    await testPrisma.clanMember.create({ data: { clanId: clan.id, characterId: patient.character.id, roleId: role.id } })
    const now = new Date()
    await testPrisma.character.update({
      where: { id: patient.character.id },
      data: { injuryTier: 'CRITICAL', injuryUntil: new Date(now.getTime() + 240 * minute), injuryCriticalAt: now },
    })

    await expect(HospitalService.brigadeAid(patient.user.id, patient.character.id, now)).rejects.toThrow('товарищ')
    const status = await HospitalService.status(boss.user.id, now)
    expect(status.brigade?.patients).toMatchObject([{ id: patient.character.id, level: 'Пассажир', reason: null }])
    await HospitalService.brigadeAid(boss.user.id, patient.character.id, now)
    expect(await state(patient.character.id)).toMatchObject({ injuryAidCount: 1, injuryUntil: new Date(now.getTime() + 180 * minute) })
    expect(await testPrisma.clan.findUniqueOrThrow({ where: { id: clan.id } })).toMatchObject({ treasury: 4000 })
    expect(await testPrisma.clanMember.findUniqueOrThrow({ where: { characterId: patient.character.id } })).toMatchObject({ treasuryDebt: 1000 })
    await expect(HospitalService.brigadeAid(boss.user.id, patient.character.id, new Date(now.getTime() + 31 * minute))).rejects.toThrow('Лимит')

    await testPrisma.clanMember.update({ where: { characterId: patient.character.id }, data: { authority: 150 } })
    await expect(HospitalService.brigadeAid(boss.user.id, patient.character.id, new Date(now.getTime() + 31 * minute))).rejects.toThrow('Сначала верни старое')

    // Взнос в общак: долг гасится, авторитет растёт (2 за тысячу).
    await testPrisma.character.update({ where: { id: patient.character.id }, data: { injuryTier: null, injuryUntil: null } })
    const fighterRole = await testPrisma.clanRole.findUniqueOrThrow({ where: { id: role.id } })
    if (!(Array.isArray(fighterRole.permissions) && fighterRole.permissions.includes('TREASURY_PUT'))) {
      await testPrisma.clanRole.update({ where: { id: role.id }, data: { permissions: [...(fighterRole.permissions as string[]), 'TREASURY_PUT'] } })
    }
    await ClansService.depositTreasury(patient.character.id, 2000)
    expect(await testPrisma.clanMember.findUniqueOrThrow({ where: { characterId: patient.character.id } }))
      .toMatchObject({ treasuryDebt: 0, authority: 154 })
  })
})
