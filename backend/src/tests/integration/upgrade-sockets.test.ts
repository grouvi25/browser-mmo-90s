// Вставка камней: панель «Государственная вставка камней» из макета.
// Камень покупается у казны в момент вставки, огранка говорит, куда
// лягут очки, гнёзд у вещи два.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { SocketsService } from '../../modules/upgrades/upgrades.sockets.service'
import { socketAllocation } from '../../modules/upgrades/upgrades.stones'
import { applyUpgradeModifiers } from '../../modules/upgrades/upgrades.formulas'

async function fixture(money = 10_000) {
  const login = uid('sock')
  const user = await testPrisma.user.create({
    data: { login, email: `${login}@test.local`, passwordHash: 'x' },
  })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money },
  })
  const template = await testPrisma.itemTemplate.create({
    data: {
      code: uid('sockitem'), name: 'TT', type: 'WEAPON', weaponType: 'PISTOL',
      minDamage: 50, maxDamage: 100, weaponAccuracy: .78, weight: 1,
      durabilityMax: 100, priceBase: 2400, itemTier: 2, sourceType: 'PRIVATE', upgradeAllowed: true,
    },
  })
  const item = await testPrisma.itemInstance.create({
    data: {
      templateId: template.id, ownerId: character.id, quality: 'COMMON',
      durabilityCurrent: 80, durabilityMax: 100, weight: 1, sourceType: 'PRIVATE',
    },
  })
  return { character, item, template }
}

describe('SocketsService', () => {
  beforeAll(() => testPrisma.$connect())
  beforeEach(() => cleanDatabase())
  afterAll(() => testPrisma.$disconnect())

  it('preview counts the free socket and the price without touching anything', async () => {
    const { character, item } = await fixture()
    const p = await SocketsService.preview(character.id, item.id, 'stone_grade_2', 'DAMAGE')
    expect(p).toMatchObject({
      socketsUsed: 0, socketsMax: 2, price: 10,
      gain: { kind: 'DAMAGE', points: 2 }, canCommit: true,
    })
    const saved = await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: item.id } })
    expect(saved.socketsJson).toBeNull()
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).money).toBe(10_000)
  })

  it('inserts a stone, charges the price and replays the same key for free', async () => {
    const { character, item } = await fixture()
    const first = await SocketsService.insert(character.id, item.id, 'stone_grade_2', 'DAMAGE', 'socket-key')
    const replay = await SocketsService.insert(character.id, item.id, 'stone_grade_2', 'DAMAGE', 'socket-key')
    expect(first.socketsUsed).toBe(1)
    expect(replay.replayed).toBe(true)
    const saved = await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: item.id } })
    expect(saved.socketsJson).toEqual([{ stone: 'stone_grade_2', cut: 'DAMAGE' }])
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).money).toBe(9_990)
    expect(await testPrisma.itemLog.count({ where: { actionCode: 'SOCKET_INSERTED' } })).toBe(1)
  })

  it('two sockets fill up and the third insert is refused without charging', async () => {
    const { character, item } = await fixture()
    await SocketsService.insert(character.id, item.id, 'stone_grade_1', 'DAMAGE', 'socket-1')
    await SocketsService.insert(character.id, item.id, 'stone_grade_1', 'ACCURACY', 'socket-2')
    const money = (await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).money
    await expect(SocketsService.insert(character.id, item.id, 'stone_grade_1', 'CRIT', 'socket-3'))
      .rejects.toMatchObject({ statusCode: 400 })
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).money).toBe(money)
  })

  it('the stone reaches the numbers the battle reads', async () => {
    const { character, item, template } = await fixture()
    await SocketsService.insert(character.id, item.id, 'stone_grade_3', 'DAMAGE', 'socket-stats')
    const saved = await testPrisma.itemInstance.findUniqueOrThrow({
      where: { id: item.id }, include: { template: true },
    })
    expect(socketAllocation(saved.socketsJson)).toEqual({ DAMAGE: 3 })
    const before = applyUpgradeModifiers(template, {}, null, null)
    const after = applyUpgradeModifiers(saved.template, {}, saved.statAllocation, saved.socketsJson)
    expect(after.minDamage).toBeGreaterThan(before.minDamage)
  })

  it('refuses a foreign item, a cut that does not fit and an unknown stone', async () => {
    const mine = await fixture()
    const other = await fixture()
    await expect(SocketsService.insert(other.character.id, mine.item.id, 'stone_grade_1', 'DAMAGE', 'socket-foreign'))
      .rejects.toMatchObject({ statusCode: 403 })
    // Броня на оружие не встаёт — те же правила, что у повышения уровня.
    await expect(SocketsService.insert(mine.character.id, mine.item.id, 'stone_grade_1', 'ARMOR', 'socket-wrong-cut'))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(SocketsService.insert(mine.character.id, mine.item.id, 'stone_grade_9', 'DAMAGE', 'socket-no-stone'))
      .rejects.toMatchObject({ statusCode: 400 })
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: mine.character.id } })).money).toBe(10_000)
  })

  it('a broken item takes no stone', async () => {
    const { character, item } = await fixture()
    await testPrisma.itemInstance.update({ where: { id: item.id }, data: { status: 'BROKEN' } })
    await expect(SocketsService.insert(character.id, item.id, 'stone_grade_1', 'DAMAGE', 'socket-broken'))
      .rejects.toMatchObject({ statusCode: 409 })
  })
})
