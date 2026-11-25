import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { BattleService, type LiveBattleState } from '../../modules/battles/battles.service'
import { HospitalService, recordFairInjury } from '../../modules/battles/hospital.service'
import { BattleRedis } from '../../shared/db/redis'
import { withTransaction } from '../../shared/db/transaction'

const minute = 60_000

async function player(dollars = 0) {
  const id = uid('injured')
  const user = await testPrisma.user.create({ data: { login: id, email: id + '@test.local', passwordHash: 'test' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: id, archetype: 'WORKER', hpCurrent: 100, hpMax: 100,
      battleLevel: 7, money: 5000, dollars, stats: { create: {} } },
    include: { stats: true },
  })
  return { user, character }
}

/** Настоящая дуэль со Стрелок, доведённая до конца: проигравший потерял все HP. */
async function finishDuel(winner: Awaited<ReturnType<typeof player>>, loser: Awaited<ReturnType<typeof player>>) {
  const { battleId } = await BattleService.createPvpDuel(winner.user.id)
  await BattleService.acceptPvpDuel(loser.user.id, battleId)
  const state = await BattleRedis.getState<LiveBattleState>(battleId)
  if (!state) throw new Error('Не удалось загрузить дуэль')
  const left = state.participants.find(p => p.characterId === winner.character.id)!
  const right = state.participants.find(p => p.characterId === loser.character.id)!
  Object.assign(left, { hpCurrent: 90, damageDealt: 100, damageReceived: 10 })
  Object.assign(right, { hpCurrent: 0, damageDealt: 10, damageReceived: 100, isAlive: false })
  return BattleService._finishPvpBattle(battleId, state, winner.character, loser.character, left, right,
    winner.character.id, null, null, 0, 0)
}

describe('травмы v8: больница и ЧМЦ', () => {
  beforeAll(() => testPrisma.$connect())
  beforeEach(() => cleanDatabase())
  afterEach(() => { vi.restoreAllMocks() })
  afterAll(() => testPrisma.$disconnect())

  it('дуэль даёт проигравшему тяжёлую: бои закрыты, травмпункт берёт плату один раз', async () => {
    const winner = await player()
    const loser = await player()
    vi.spyOn(Math, 'random').mockReturnValue(0.32)
    await finishDuel(winner, loser)
    vi.restoreAllMocks()

    const now = new Date()
    expect((await HospitalService.status(loser.user.id, now)).injury)
      .toMatchObject({ tier: 'HEAVY', blocksCombat: true, hospital: { rubles: 500, waitMinutes: 10 }, clinic: { dollars: 2 } })
    expect((await HospitalService.status(winner.user.id, now)).injury).toBeNull()
    expect(await testPrisma.gameNotice.count({ where: { characterId: loser.character.id, text: { contains: 'тяжёлые травмы' } } })).toBe(1)
    await testPrisma.character.update({ where: { id: loser.character.id }, data: { status: 'ACTIVE' } })
    await expect(BattleService.createPvpDuel(loser.user.id)).rejects.toThrow('Тяжёлая травма')

    const results = await Promise.allSettled([HospitalService.treat(loser.user.id, now), HospitalService.treat(loser.user.id, now)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await testPrisma.currencyLog.count({ where: { characterId: loser.character.id, reasonCode: 'HOSPITAL' } })).toBe(1)
    expect(await testPrisma.character.findUniqueOrThrow({ where: { id: loser.character.id } })).toMatchObject({
      money: 4500, injuryUntil: new Date(now.getTime() + 10 * minute),
    })
    expect((await HospitalService.status(loser.user.id, now)).injury).toMatchObject({ treated: true, hospital: null })
    expect((await HospitalService.status(loser.user.id, new Date(now.getTime() + 11 * minute))).injury).toBeNull()
  })

  it('победитель дуэли травм не получает, проигравший может уехать в реанимацию', async () => {
    const winner = await player()
    const loser = await player()
    vi.spyOn(Math, 'random').mockReturnValue(0.36)
    await finishDuel(winner, loser)
    vi.restoreAllMocks()

    const now = new Date()
    expect((await HospitalService.status(winner.user.id, now)).injury).toBeNull()
    expect((await HospitalService.status(loser.user.id, now)).injury)
      .toMatchObject({ tier: 'CRITICAL', blocksCombat: true, reanimation: { self: { rubles: 2000, minutes: 60 } } })
    expect(await testPrisma.gameNotice.count({ where: { characterId: loser.character.id, text: { contains: 'критическом состоянии' } } })).toBe(1)
    expect(await testPrisma.gameNotice.count({ where: { characterId: winner.character.id } })).toBe(0)
  })

  it('ЧМЦ лечит среднюю сразу за доллары и не берёт лёгкую', async () => {
    const patient = await player(0)
    const now = new Date()
    vi.spyOn(Math, 'random').mockReturnValue(0.25)
    await withTransaction(tx => recordFairInjury(tx, patient.character.id, { won: false }, now))
    vi.restoreAllMocks()
    expect((await HospitalService.status(patient.user.id, now)).injury).toMatchObject({ tier: 'MEDIUM', blocksCombat: false, penaltyPercent: 10 })

    await expect(HospitalService.clinic(patient.user.id, now)).rejects.toThrow('Не хватает долларов')
    await testPrisma.character.update({ where: { id: patient.character.id }, data: { dollars: 5 } })
    await HospitalService.clinic(patient.user.id, now)
    expect(await testPrisma.character.findUniqueOrThrow({ where: { id: patient.character.id } }))
      .toMatchObject({ dollars: 4, injuryTier: null, injuryUntil: null })
    expect(await testPrisma.dollarLog.count({ where: { characterId: patient.character.id, reason: 'CLINIC', amount: -1 } })).toBe(1)

    vi.spyOn(Math, 'random').mockReturnValue(0)
    await withTransaction(tx => recordFairInjury(tx, patient.character.id, { won: false }, now))
    vi.restoreAllMocks()
    await expect(HospitalService.clinic(patient.user.id, now)).rejects.toThrow('не принимает')
  })
})
