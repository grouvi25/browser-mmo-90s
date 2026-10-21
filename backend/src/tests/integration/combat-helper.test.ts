/**
 * Боевой помощник в настоящем бою с ботом (правка заказчика 21.10): выходит
 * с хозяином, бьёт вслед за ним, принимает удары на себя, пишется в журнал
 * своим именем, получает опыт. Без подписки в бой не выходит.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BattleService, type LiveBattleState } from '../../modules/battles/battles.service'
import { BattleJournal } from '../../modules/battles/battle-journal'
import { HelpersService } from '../../modules/premium/helpers.service'
import { PremiumService, isGrantImplemented } from '../../modules/premium/premium.service'
import { PREMIUM_PRODUCTS } from '../../../prisma/economy-data'
import { BattleRedis, disconnectRedis, getRedis } from '../../shared/db/redis'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function seedShop() {
  for (const p of PREMIUM_PRODUCTS) {
    await testPrisma.premiumProduct.create({
      data: {
        code: p.code, name: p.name, description: p.description, kind: p.kind,
        priceRub: p.priceRub, grantCode: p.grantCode, grantValue: p.grantValue, sortOrder: p.sortOrder,
        isActive: isGrantImplemented(p.grantCode),
      },
    })
  }
}

async function fighter(prefix: string, premium = true) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'STREET', hpCurrent: 400, hpMax: 400, money: 1_000, battleLevel: 3, status: 'ACTIVE' },
  })
  await testPrisma.characterStats.create({ data: { characterId: character.id } })
  if (premium) await PremiumService.grant({ characterId: character.id, productCode: 'prem_sub_30' })
  return { user, character }
}

/** Ставит бойцов вплотную: проверяем помощника, а не подход к цели. */
async function closeIn(battleId: string) {
  const state = (await BattleRedis.getState<LiveBattleState>(battleId))!
  const [a, b] = state.participants
  b.position = { x: a.position.x + 1, y: a.position.y }
  await BattleRedis.setState(battleId, state)
}

describe('боевой помощник в бою', () => {
  beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping() })
  beforeEach(async () => {
    await cleanDatabase()
    await testPrisma.premiumPurchase.deleteMany()
    await testPrisma.premiumProduct.deleteMany()
    await seedShop()
  })
  afterAll(async () => { vi.restoreAllMocks(); await testPrisma.$disconnect(); await disconnectRedis() })

  it('выходит с хозяином, бьёт и принимает удары, пишется в журнал и получает опыт', async () => {
    const a = await fighter('master')
    const hired = await HelpersService.hire(a.character.id, 'Рекс', '', 'COMBAT')
    await HelpersService.setTactic(a.character.id, hired.id, 'DEFENSIVE')
    // Заметно повысить шанс перехвата нельзя без кода — фиксируем случайность:
    // 0.1 — удар помощника проходит, защитная тактика перехватывает.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.1)

    const { battleId } = await BattleService.startPve(a.user.id, 'training_bandit')
    const started = (await BattleRedis.getState<LiveBattleState>(battleId))!
    expect(started.participants.find(p => p.characterId === a.character.id)!.helper).toMatchObject({ name: 'Рекс', tactic: 'DEFENSIVE', alive: true, level: 1 })
    await closeIn(battleId)

    let over = false
    for (let i = 0; i < 30 && !over; i++) {
      const res = await BattleService.submitAction(a.user.id, battleId, {
        action: 'attack', stance: 'mixed', attackZones: ['CHEST'], attackHands: ['LEFT_HAND'], blockZones: ['HEAD', 'CHEST'],
      }) as { battleOver?: boolean }
      over = !!res.battleOver
    }
    random.mockRestore()

    const helperTurns = await testPrisma.battleTurn.count({ where: { battleId, actorHelperId: hired.id } })
    expect(helperTurns).toBeGreaterThan(0)
    const journal = await BattleJournal.page(battleId, 1)
    expect(journal.items.some(l => l.actor === 'Рекс (помощник)' && l.side === 1)).toBe(true)

    if (over) {
      const after = await testPrisma.helper.findUniqueOrThrow({ where: { id: hired.id } })
      expect(after.combatExp).toBeGreaterThan(0)
    }
  })

  it('смена тактики в бою действует и запоминается', async () => {
    const a = await fighter('tactic')
    const hired = await HelpersService.hire(a.character.id, 'Бим', '', 'COMBAT')
    const { battleId } = await BattleService.startPve(a.user.id, 'training_bandit')
    await BattleService.setHelperTactic(battleId, a.user.id, 'ATTACK')
    const state = (await BattleRedis.getState<LiveBattleState>(battleId))!
    expect(state.participants.find(p => p.characterId === a.character.id)!.helper!.tactic).toBe('ATTACK')
    expect((await testPrisma.helper.findUniqueOrThrow({ where: { id: hired.id } })).tactic).toBe('ATTACK')
  })

  it('без подписки помощник в бой не выходит; рабочий помощник — тоже', async () => {
    const a = await fighter('nosub')
    await HelpersService.hire(a.character.id, 'Шарик', '', 'COMBAT')
    await testPrisma.character.update({ where: { id: a.character.id }, data: { premiumExpiresAt: new Date(Date.now() - 1000), isPremium: false } })
    const { battleId } = await BattleService.startPve(a.user.id, 'training_bandit')
    const state = (await BattleRedis.getState<LiveBattleState>(battleId))!
    expect(state.participants.find(p => p.characterId === a.character.id)!.helper).toBeUndefined()

    const b = await fighter('worker')
    await HelpersService.hire(b.character.id, 'Работяга', 'scrap_collector', 'WORK')
    const second = await BattleService.startPve(b.user.id, 'training_bandit')
    const st2 = (await BattleRedis.getState<LiveBattleState>(second.battleId))!
    expect(st2.participants.find(p => p.characterId === b.character.id)!.helper).toBeUndefined()
  })

  it('тактику можно менять только боевому помощнику', async () => {
    const a = await fighter('kind')
    const worker = await HelpersService.hire(a.character.id, 'Работяга', 'scrap_collector', 'WORK')
    await expect(HelpersService.setTactic(a.character.id, worker.id, 'ATTACK')).rejects.toMatchObject({ statusCode: 422 })
  })

  it('в групповом бою бьёт цель хозяина и пишется в журнал за его сторону', async () => {
    const a = await fighter('teamA')
    const b = await fighter('teamB', false)
    const hired = await HelpersService.hire(a.character.id, 'Тузик', '', 'COMBAT')
    await HelpersService.setTactic(a.character.id, hired.id, 'ATTACK')
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.1)
    const { battleId } = await BattleService.createTeamBattle(a.user.id, 1)
    await BattleService.joinTeamBattle(b.user.id, battleId, 2)
    await BattleService.startTeamBattle(a.user.id, battleId)
    await closeIn(battleId)
    const turn = { action: 'attack', stance: 'mixed' as const, attackZones: ['CHEST' as const], attackHands: ['LEFT_HAND' as const], blockZones: ['HEAD' as const, 'LEFT_ARM' as const] }
    for (let i = 0; i < 6; i++) {
      const state = await BattleRedis.getState<LiveBattleState>(battleId)
      if (!state || state.status !== 'active') break
      await BattleService.submitAction(a.user.id, battleId, turn)
      const res = await BattleService.submitAction(b.user.id, battleId, turn) as { battleOver?: boolean }
      if (res.battleOver) break
    }
    random.mockRestore()
    expect(await testPrisma.battleTurn.count({ where: { battleId, actorHelperId: hired.id, targetCharId: b.character.id } })).toBeGreaterThan(0)
    const journal = await BattleJournal.page(battleId, 1)
    expect(journal.items.some(l => l.actor === 'Тузик (помощник)' && l.side === 1)).toBe(true)
  })
})
