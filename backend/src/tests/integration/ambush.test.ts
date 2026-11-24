import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, paidClan, testPrisma, uid } from './helpers'
import { AmbushService } from '../../modules/battles/ambush.service'
import { HospitalService } from '../../modules/battles/hospital.service'
import { ClansService } from '../../modules/clans/clans.service'
import { CityService } from '../../modules/city/city.service'
import { ChatRedis } from '../../shared/db/redis'

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

  it('бинокль покупается один, засада отправляет цель в реанимацию, на беспомощного не бьют', async () => {
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

    const now = new Date()
    const result = await AmbushService.ambush(hunter.user.id, victim.character.id, now, 0)
    expect(result).toMatchObject({ success: true, tier: 'CRITICAL' })
    expect(await state(hunter.character.id)).toMatchObject({ pocketBinoculars: 0, injuryTier: null })
    expect(await state(victim.character.id)).toMatchObject({
      injuryTier: 'CRITICAL', injuryUntil: new Date(now.getTime() + 240 * minute), location: '/hospital',
    })
    expect(await testPrisma.gameNotice.count({ where: { characterId: victim.character.id, text: { contains: 'Вас атаковал' } } })).toBe(1)
    expect(await CityService.location(victim.user.id)).toMatchObject({ path: '/hospital' })
    await expect(CityService.move(victim.user.id, '/market')).rejects.toThrow('реанимации')

    await testPrisma.character.update({ where: { id: hunter.character.id }, data: { pocketBinoculars: 1 } })
    await expect(AmbushService.ambush(hunter.user.id, victim.character.id, now, 0)).rejects.toThrow('беспомощного')
  })

  it('провал кладёт нападающего, второе критическое за сутки — кома', async () => {
    const hunter = await player()
    const victim = await player()
    await testPrisma.character.update({
      where: { id: hunter.character.id },
      data: { pocketBinoculars: 1, injuryCriticalAt: new Date(Date.now() - 3 * 3_600_000) },
    })
    const result = await AmbushService.ambush(hunter.user.id, victim.character.id, new Date(), 0.99)
    expect(result).toMatchObject({ success: false, tier: 'COMA' })
    expect(await state(hunter.character.id)).toMatchObject({ injuryTier: 'COMA' })
    expect(await state(victim.character.id)).toMatchObject({ injuryTier: null })
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
