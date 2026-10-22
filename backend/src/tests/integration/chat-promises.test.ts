/**
 * Обещания игрокам из чата 22.10: характеристики черновиком и свитки,
 * обменник, модераторы, комплекты одежды, поиск и чужие бои, бригада с 7-го
 * уровня, защита новичков, износ.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { storeSession } from '../../shared/security/jwt'
import { getRedis } from '../../shared/db/redis'
import { ChatService } from '../../modules/chat/chat.service'
import { ClansService } from '../../modules/clans/clans.service'
import { HousingService } from '../../modules/housing/housing.service'
import { LOTS } from '../../modules/housing/housing.config'
import { EXCHANGE } from '../../modules/dollars/dollars.service'
import { applyBattleProgression } from '../../modules/experience/progression'
import { cleanDatabase, testPrisma, uid } from './helpers'

let app: FastifyInstance
beforeAll(async () => { app = await buildApp(); await app.ready() })
afterAll(async () => { await app.close(); await testPrisma.$disconnect() })
beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })

async function player(opts: { level?: number; money?: number; dollars?: number; end?: number } = {}) {
  const login = uid('pr')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'WORKER', hpCurrent: 100, hpMax: 100, money: opts.money ?? 100_000, dollars: opts.dollars ?? 0, battleLevel: opts.level ?? 3 },
  })
  // WORKER: база + str/end по +1.
  await testPrisma.characterStats.create({ data: { characterId: character.id, str: 4, end: opts.end ?? 4, pointsAvailable: 3 } })
  const jti = randomUUID(); await storeSession(jti, user.id)
  return { user, character, headers: { authorization: `Bearer ${app.jwt.sign({ sub: user.id, jti })}` } }
}

const post = (url: string, headers: Record<string, string>, payload: unknown = {}) => app.inject({ method: 'POST', url, headers, payload: payload as object })

describe('Обещания из чата 22.10', () => {
  it('характеристики: черновик подтверждается разом, свиток возвращает очки, HP пересчитывается', async () => {
    const p = await player()
    const bad = await post('/api/characters/stats/apply', p.headers, { deltas: { end: 2, agi: 2 } })
    expect(bad.statusCode).toBe(409)
    const ok = await post('/api/characters/stats/apply', p.headers, { deltas: { end: 2, agi: 1 } })
    expect(ok.statusCode).toBe(200)
    let stats = await testPrisma.characterStats.findUniqueOrThrow({ where: { characterId: p.character.id } })
    expect(stats).toMatchObject({ end: 6, agi: 4, pointsAvailable: 0, respecScrolls: 2 })
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: p.character.id } })).hpMax).toBe(60 + 6 * 6 + 3 * 2)

    expect((await post('/api/characters/stats/respec', p.headers)).statusCode).toBe(200)
    stats = await testPrisma.characterStats.findUniqueOrThrow({ where: { characterId: p.character.id } })
    expect(stats).toMatchObject({ end: 4, agi: 3, pointsAvailable: 3, respecScrolls: 1 })
    // Вкладывать нечего — свиток не тратится.
    expect((await post('/api/characters/stats/respec', p.headers)).statusCode).toBe(409)

    expect((await post('/api/characters/stats/respec/buy', p.headers)).statusCode).toBe(200)
    stats = await testPrisma.characterStats.findUniqueOrThrow({ where: { characterId: p.character.id } })
    expect(stats.respecScrolls).toBe(2)
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: p.character.id } })).money).toBe(95_000)
  })

  it('обменник: покупка и продажа по курсам, суточный потолок покупки', async () => {
    const p = await player({ money: 1_000_000, dollars: 10 })
    expect((await post('/api/dollars/exchange', p.headers, { direction: 'buy', dollars: 5 })).statusCode).toBe(200)
    let c = await testPrisma.character.findUniqueOrThrow({ where: { id: p.character.id } })
    expect(c).toMatchObject({ dollars: 15, money: 1_000_000 - 5 * EXCHANGE.buyRate })
    expect((await post('/api/dollars/exchange', p.headers, { direction: 'sell', dollars: 15 })).statusCode).toBe(200)
    c = await testPrisma.character.findUniqueOrThrow({ where: { id: p.character.id } })
    expect(c).toMatchObject({ dollars: 0, money: 1_000_000 - 5 * EXCHANGE.buyRate + 15 * EXCHANGE.sellRate })
    const over = await post('/api/dollars/exchange', p.headers, { direction: 'buy', dollars: EXCHANGE.dailyBuyLimit })
    expect(over.statusCode).toBe(409)
    expect((await post('/api/dollars/exchange', p.headers, { direction: 'sell', dollars: 1 })).statusCode).toBe(409)
  })

  it('модераторы: в сети — первыми', async () => {
    const viewer = await player()
    const a = await player(); const b = await player()
    await testPrisma.character.updateMany({ where: { id: { in: [a.character.id, b.character.id] } }, data: { isModerator: true } })
    await ChatService.touch(b.character.id)
    const res = await app.inject({ url: '/api/support/moderators', headers: viewer.headers })
    const items = res.json<{ items: { nickname: string; online: boolean }[] }>().items
    expect(items.map(i => i.online)).toEqual([true, false])
    expect(items[0].nickname).toBe(b.character.nickname)
  })

  it('комплект: сохраняет надетое и надевает обратно одной кнопкой', async () => {
    const p = await player()
    const tpl = await testPrisma.itemTemplate.create({ data: { code: uid('knife'), name: 'Нож', type: 'WEAPON', weaponType: 'KNIFE', minDamage: 2, maxDamage: 4, weight: 1, durabilityMax: 50, priceBase: 100, isEquippable: true } })
    const knife = await testPrisma.itemInstance.create({ data: { templateId: tpl.id, ownerId: p.character.id, quality: 'COMMON', durabilityCurrent: 50, durabilityMax: 50, weight: 1, sourceType: 'GOVERNMENT', isEquipped: true, status: 'EQUIPPED', armorSlot: 'RIGHT_HAND' } })
    expect((await post('/api/inventory/outfits/1/save', p.headers, { name: 'Дуэль' })).statusCode).toBe(200)
    await testPrisma.itemInstance.update({ where: { id: knife.id }, data: { isEquipped: false, status: 'NORMAL', armorSlot: null } })
    const worn = await post('/api/inventory/outfits/1/wear', p.headers)
    expect(worn.json()).toMatchObject({ equipped: 1, skipped: [] })
    expect(await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: knife.id } })).toMatchObject({ isEquipped: true, armorSlot: 'RIGHT_HAND' })
    expect((await post('/api/inventory/outfits/2/wear', p.headers)).statusCode).toBe(409)
    const list = await app.inject({ url: '/api/inventory/outfits', headers: p.headers })
    expect(list.json()).toMatchObject({ slots: 3, items: [{ slot: 1, name: 'Дуэль', count: 1 }] })
  })

  it('поиск бойца и его история боёв', async () => {
    const viewer = await player()
    const target = await player({ level: 6 })
    const found = await app.inject({ url: `/api/characters/search?q=${encodeURIComponent(target.character.nickname.slice(0, 8))}`, headers: viewer.headers })
    expect(found.json<{ items: { nickname: string }[] }>().items.map(i => i.nickname)).toContain(target.character.nickname)
    const history = await app.inject({ url: `/api/battles/history/${encodeURIComponent(target.character.nickname)}`, headers: viewer.headers })
    expect(history.statusCode).toBe(200)
    expect(history.json()).toMatchObject({ nickname: target.character.nickname, total: 0 })
    expect((await app.inject({ url: '/api/battles/history/nobody-here', headers: viewer.headers })).statusCode).toBe(404)
  })

  it('бригада принимает с 7-го уровня', async () => {
    const boss = await player({ level: 7 })
    await ClansService.create(boss.character.id, uid('br').slice(0, 30))
    const young = await player({ level: 6 })
    await expect(ClansService.invite(boss.character.id, { characterId: young.character.id })).rejects.toMatchObject({ statusCode: 403 })
    const grown = await player({ level: 7 })
    await expect(ClansService.invite(boss.character.id, { characterId: grown.character.id })).resolves.toBeTruthy()
  })

  it('на дом новичка налёт не объявить', async () => {
    const owner = await player({ level: 2, dollars: 500 })
    const { home } = await HousingService.buy(owner.character.id, LOTS.apartments + 1)
    const raider = await player({ level: 5 })
    await expect(HousingService.fileRaid(raider.character.id, home.id)).rejects.toThrow(/новичок/)
  })

  it('после боя — напоминание о вещи, которая почти сломалась, не чаще раза в сутки', async () => {
    const p = await player()
    const tpl = await testPrisma.itemTemplate.create({ data: { code: uid('vest'), name: 'Жилет', type: 'ARMOR', armorSlot: 'CHEST', weight: 1, durabilityMax: 100, priceBase: 100, isEquippable: true } })
    await testPrisma.itemInstance.create({ data: { templateId: tpl.id, ownerId: p.character.id, quality: 'COMMON', durabilityCurrent: 15, durabilityMax: 100, weight: 1, sourceType: 'GOVERNMENT', isEquipped: true, status: 'EQUIPPED', armorSlot: 'CHEST' } })
    const char = await testPrisma.character.findUniqueOrThrow({ where: { id: p.character.id }, include: { stats: true } })
    for (let i = 0; i < 2; i++) await testPrisma.$transaction(tx => applyBattleProgression(tx, char, { expGain: 0, hpCurrentAfterBattle: 50, won: true }))
    const notices = await testPrisma.gameNotice.findMany({ where: { characterId: p.character.id } })
    expect(notices).toHaveLength(1)
    expect(notices[0].text).toContain('Вещь «Жилет» почти сломана: прочность 15/100')
  })
})
