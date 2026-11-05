/**
 * Настойки и свитки на настоящих запросах: что вещь тратится, эффект записывается,
 * доходит до расчёта боя и кончается вовремя. Заказчик #4229, таблица v2.
 */
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../app'
import { armorListFromEquipped, BattleService, buildAttackerSnapshotAsync, buildDefenderSnapshot, executeStrikes, tickBattleEffects, type LiveBattleState, type LiveParticipant } from '../../modules/battles/battles.service'
import { EMPTY_GEAR } from '../../modules/items/gear-bonuses'
import { BattleJournal } from '../../modules/battles/battle-journal'
import { CharactersService } from '../../modules/characters/characters.service'
import { disconnectRedis, getRedis } from '../../shared/db/redis'
import { storeSession } from '../../shared/security/jwt'
import { cleanDatabase, testPrisma, uid } from './helpers'

let app: FastifyInstance
beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping(); app = await buildApp(); await app.ready() })
beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })
afterAll(async () => { await app.close(); await testPrisma.$disconnect(); await disconnectRedis() })

type Part = { characterId?: string; botId?: string; hpCurrent: number; hpMax: number; healedTotal: number; damageDealt: number }

async function fixture(hpCurrent = 40) {
  const login = uid('fx')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'ATHLETE', hpCurrent, hpMax: 100, battleLevel: 3 },
  })
  await testPrisma.characterStats.create({
    data: { characterId: character.id, str: 5, agi: 5, rea: 5, acc: 5, end: 5, luck: 5, agr: 5, auth: 5 },
  })
  const jti = randomUUID()
  await storeSession(jti, user.id)
  const headers = { authorization: `Bearer ${app.jwt.sign({ sub: user.id, jti })}` }
  const item = async (useEffect: object, extra: { healPercent?: number } = {}) => {
    const template = await testPrisma.itemTemplate.create({
      data: { code: uid('fx'), name: 'Вещь', type: 'CONSUMABLE', weight: 0, durabilityMax: 1, priceBase: 50, useEffect, ...extra },
    })
    return testPrisma.itemInstance.create({
      data: { templateId: template.id, ownerId: character.id, durabilityCurrent: 1, durabilityMax: 1, weight: 0, sourceType: 'CRAFTED' },
    })
  }
  const use = (id: string) => app.inject({ method: 'POST', url: '/api/inventory/use-item', headers, payload: { itemInstanceId: id } })
  const fresh = () => testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })
  return { user, character, item, use, fresh }
}

const bot = (hpMax = 500) => testPrisma.bot.create({
  data: { code: uid('bot'), name: 'Хулиган', battleLevel: 1, hpMax, stats: {}, equipment: {} },
})

async function startWith(user: { id: string }, itemId: string, botCode: string) {
  await CharactersService.setBattleLoadout(user.id, [itemId])
  const { battleId } = await BattleService.startPve(user.id, botCode) as { battleId: string }
  return battleId
}

const parts = async (battleId: string, userId: string) =>
  ((await BattleService.getBattle(battleId, userId)).liveState as { participants: Part[]; roundNumber: number })

describe('настойка вне боя', () => {
  it('тратится, пишет эффект на 10 минут и не лечит', async () => {
    const { item, use, fresh } = await fixture()
    const potion = await item({ buffs: [{ stat: 'damage', value: 0.1 }], minutes: 10 })
    const before = Date.now()
    const res = await use(potion.id)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ hpRestored: 0, effectText: 'урон +10% на 10 мин' })
    const active = (await fresh()).activeEffects as Array<{ buffs: unknown[]; expiresAt: string }>
    expect(active).toHaveLength(1)
    expect(new Date(active[0].expiresAt).getTime()).toBeGreaterThanOrEqual(before + 9.9 * 60_000)
    expect((await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: potion.id } })).status).toBe('DELETED')
  })

  it('при полном здоровье настойка применяется: она не лечит', async () => {
    const { item, use } = await fixture(100)
    expect((await use((await item({ buffs: [{ stat: 'agi', value: 2 }], minutes: 10 })).id)).statusCode).toBe(200)
  })

  it('свиток вне боя отказывает и не сгорает', async () => {
    const { item, use, fresh } = await fixture()
    const scroll = await item({ buffs: [{ stat: 'armor', value: 0.15 }], rounds: 3 })
    const res = await use(scroll.id)
    expect(res.statusCode).toBe(409)
    expect((await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: scroll.id } })).status).not.toBe('DELETED')
    expect((await fresh()).activeEffects).toEqual([])
  })
})

describe('свиток в бою', () => {
  it('тратится, записывается на текущий бой и пишется в журнал', async () => {
    const { user, item, fresh } = await fixture()
    const scroll = await item({ buffs: [{ stat: 'armor', value: 0.15 }], rounds: 3 })
    const { code } = await bot()
    const battleId = await startWith(user, scroll.id, code)
    await BattleService.submitAction(user.id, battleId, { action: 'use_item', itemInstanceId: scroll.id })

    expect((await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: scroll.id } })).status).toBe('DELETED')
    const [effect] = (await fresh()).activeEffects as Array<{ battleId: string; fromRound: number; untilRound: number }>
    expect(effect).toMatchObject({ battleId, fromRound: 1, untilRound: 3 })
    const turn = await testPrisma.battleTurn.findFirstOrThrow({ where: { battleId, action: 'USE_ITEM' } })
    expect(turn.logLine).toContain('броня +15% на 3 раунда')
    const { items } = await BattleJournal.page(battleId, 1) as { items: Array<{ entries?: Array<{ text: string }> }> }
    expect(JSON.stringify(items)).toContain('использует Вещь: броня +15% на 3 раунда')
  })

  it('свиток здоровья лечит процентом от максимума', async () => {
    const { user, character } = await fixture(40)
    const template = await testPrisma.itemTemplate.create({
      data: { code: uid('w03'), name: 'Свиток здоровья', type: 'CONSUMABLE', weight: 0, durabilityMax: 1, priceBase: 50, healPercent: 25 },
    })
    const scroll = await testPrisma.itemInstance.create({
      data: { templateId: template.id, ownerId: character.id, durabilityCurrent: 1, durabilityMax: 1, weight: 0, sourceType: 'CRAFTED' },
    })
    const { code } = await bot()
    const battleId = await startWith(user, scroll.id, code)
    await BattleService.submitAction(user.id, battleId, { action: 'use_item', itemInstanceId: scroll.id })
    const turn = await testPrisma.battleTurn.findFirstOrThrow({ where: { battleId, action: 'USE_ITEM' } })
    expect(turn.logLine).toContain('+25 HP')
  })

  it('прямой урон бьёт бота мимо брони и не добивает', async () => {
    const { user, item } = await fixture()
    const scroll = await item({ directDamage: 60 })
    const { code } = await bot(40)
    const battleId = await startWith(user, scroll.id, code)
    await BattleService.submitAction(user.id, battleId, { action: 'use_item', itemInstanceId: scroll.id })
    const state = await parts(battleId, user.id)
    const enemy = state.participants.find(p => p.botId)!
    expect(enemy.hpCurrent).toBe(1)
    expect(state.participants.find(p => p.characterId)!.damageDealt).toBe(39)
  })

  it('настойка восстановления лечит сразу, потом каждый раунд и кончается', async () => {
    const { user, item, fresh } = await fixture(10)
    const potion = await item({ regenPercent: 6, rounds: 4 })
    const { code } = await bot()
    const battleId = await startWith(user, potion.id, code)
    await BattleService.submitAction(user.id, battleId, { action: 'use_item', itemInstanceId: potion.id })
    const [effect] = (await fresh()).activeEffects as Array<{ fromRound: number; untilRound: number }>
    expect(effect.untilRound - effect.fromRound).toBe(3)
    const me = (await parts(battleId, user.id)).participants.find(p => p.characterId)!
    expect(me.healedTotal).toBe(6)
  })
})

describe('эффект доходит до расчёта удара', () => {
  afterEach(() => vi.restoreAllMocks())

  const stats = { str: 5, agi: 5, rea: 5, acc: 5, end: 5, luck: 5, agr: 5, auth: 5 }
  const base = { stats, pets: [], battleLevel: 3, alcoholLevel: 0, alcoholUpdatedAt: null, barBuffExpiresAt: null, barBuffAccuracy: 0, barBuffDamage: 0 }
  const fighter = (buffs: { stat: string; value: number }[]) => ({ ...base, activeEffects: [{ code: 'x', name: 'x', buffs, expiresAt: new Date(Date.now() + 60_000).toISOString() }] }) as never
  const plain = { ...base, activeEffects: [] } as never

  it('меняет снимки атакующего и защитника', async () => {
    const before = await buildAttackerSnapshotAsync(plain, null, 0, [], EMPTY_GEAR)
    const after = await buildAttackerSnapshotAsync(fighter([
      { stat: 'damage', value: 0.15 }, { stat: 'accuracy', value: 0.25 }, { stat: 'crit', value: 0.05 }, { stat: 'agi', value: 3 },
    ]), null, 0, [], EMPTY_GEAR)
    expect(after.outgoingDamageMultiplier).toBeCloseTo(before.outgoingDamageMultiplier! + 0.15)
    expect(after.weaponAccuracy).toBeCloseTo(before.weaponAccuracy + 0.25)
    expect(after.critBonus).toBeCloseTo(before.critBonus + 0.05)
    expect(after.agi).toBe(before.agi + 3)

    const defPlain = buildDefenderSnapshot(plain, [], EMPTY_GEAR)
    const defBuffed = buildDefenderSnapshot(fighter([{ stat: 'resist', value: 0.1 }, { stat: 'end', value: 2 }]), [], EMPTY_GEAR)
    expect(defBuffed.incomingDamageMultiplier).toBeCloseTo(defPlain.incomingDamageMultiplier! * 0.9)
    expect(defBuffed.end).toBe(defPlain.end + 2)
  })

  it('броня растёт и в общем снимке, и по зонам', () => {
    const vest = { weight: 1, armorSlot: 'CHEST', upgradeModifiersJson: null, statAllocation: null, socketsJson: null, template: { armor: 100, armorSlot: 'CHEST', blockBonus: 0, dodgeBonus: 0, antiCrit: 0 } } as never
    const buffed = fighter([{ stat: 'armor', value: 0.15 }])
    expect(buildDefenderSnapshot(buffed, [vest], EMPTY_GEAR).armor).toBeCloseTo(115)
    expect(armorListFromEquipped([vest], buffed as never)[0].armor).toBeCloseTo(115)
    expect(armorListFromEquipped([vest], plain as never)[0].armor).toBe(100)
  })

  it('усиление урона видно в итоговом ударе при одинаковом случае', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const hit = async (char: never) => {
      const attackerSnap = await buildAttackerSnapshotAsync(char, null, 0, [], EMPTY_GEAR)
      attackerSnap.weaponAccuracy = 1
      attackerSnap.minDamage = 100; attackerSnap.maxDamage = 100
      return executeStrikes({
        attackerSnap, defenderSnap: buildDefenderSnapshot(plain, [], EMPTY_GEAR), zoneArmorFor: () => 0,
        attackZones: ['CHEST'], blockedZones: [], defenderHp: 100_000,
      }).damageToDefender
    }
    const without = await hit(plain)
    const withBuff = await hit(fighter([{ stat: 'damage', value: 0.5 }]))
    expect(without).toBeGreaterThan(0)
    expect(withBuff).toBeGreaterThan(without)
  })

  it('прорыв усиливает только первое попадание за ход', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const hit = async (char: never) => {
      const attackerSnap = await buildAttackerSnapshotAsync(char, null, 0, [], EMPTY_GEAR)
      attackerSnap.weaponAccuracy = 1
      attackerSnap.minDamage = 100; attackerSnap.maxDamage = 100
      return executeStrikes({
        attackerSnap, defenderSnap: buildDefenderSnapshot(plain, [], EMPTY_GEAR), zoneArmorFor: () => 0,
        attackZones: ['CHEST', 'CHEST'], blockedZones: [], defenderHp: 100_000,
      }).results.map(row => row.finalDamage)
    }
    const [first, second] = await hit(plain)
    const [buffedFirst, buffedSecond] = await hit(fighter([{ stat: 'nextHit', value: 0.25 }]))
    expect(first).toBeGreaterThan(0)
    expect(buffedFirst).toBeGreaterThan(first)
    expect(buffedSecond).toBe(second)
  })

  it('отражение возвращает долю полученного урона бьющему', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const attackerSnap = await buildAttackerSnapshotAsync(plain, null, 0, [], EMPTY_GEAR)
    attackerSnap.weaponAccuracy = 1
    attackerSnap.minDamage = 100; attackerSnap.maxDamage = 100
    const strike = (defender: never) => executeStrikes({
      attackerSnap, defenderSnap: buildDefenderSnapshot(defender, [], EMPTY_GEAR), zoneArmorFor: () => 0,
      attackZones: ['CHEST'], blockedZones: [], defenderHp: 100_000,
    })
    expect(strike(plain).counterToAttacker).toBe(0)
    const reflected = strike(fighter([{ stat: 'reflect', value: 0.1 }]))
    expect(reflected.damageToDefender).toBeGreaterThan(0)
    expect(reflected.counterToAttacker).toBe(Math.floor(reflected.damageToDefender * 0.1))
  })

  it('начало раунда отсекает кончившийся свиток и лечит настойкой', () => {
    const char = { activeEffects: [
      { code: 'a', name: 'a', buffs: [{ stat: 'armor', value: 0.15 }], battleId: 'b', fromRound: 1, untilRound: 3 },
      { code: 'r', name: 'r', buffs: [], regenPercent: 6, battleId: 'b', fromRound: 2, untilRound: 5 },
    ] } as never as Parameters<typeof tickBattleEffects>[2]
    const part = { hpCurrent: 10, hpMax: 100, healedTotal: 0, isAlive: true } as LiveParticipant
    const state = { battleId: 'b', roundNumber: 4 } as LiveBattleState
    tickBattleEffects(state, part, char)
    expect((char.activeEffects as unknown[]).length).toBe(1)
    expect(part.hpCurrent).toBe(16)
    expect(part.healedTotal).toBe(6)
  })
})

describe('свиток в дуэли', () => {
  it('эффект пишется в журнал и тут, а не только в бою с ботом', async () => {
    const a = await fixture()
    const b = await fixture()
    const scroll = await a.item({ buffs: [{ stat: 'damage', value: 0.15 }], rounds: 3 })
    await CharactersService.setBattleLoadout(a.user.id, [scroll.id])
    const open = await BattleService.createPvpDuel(a.user.id) as { battleId: string }
    await BattleService.acceptPvpDuel(b.user.id, open.battleId)

    await BattleService.submitAction(a.user.id, open.battleId, { action: 'use_item', itemInstanceId: scroll.id })
    await BattleService.submitAction(b.user.id, open.battleId, {
      action: 'block', stance: 'defense4', attackZones: [], blockZones: ['HEAD', 'CHEST', 'LEFT_ARM', 'RIGHT_ARM'],
    })

    const turn = await testPrisma.battleTurn.findFirstOrThrow({ where: { battleId: open.battleId, action: 'USE_ITEM' } })
    expect(turn.logLine).toBe('Использовал Вещь: урон +15% на 3 раунда')
    expect((await a.fresh()).activeEffects).toMatchObject([{ battleId: open.battleId, untilRound: 3 }])
    expect(JSON.stringify(await BattleJournal.page(open.battleId, 1))).toContain('использует Вещь: урон +15% на 3 раунда')
  })
})
