/**
 * Integration tests: Government Shop module
 * Tests: list, buy, sell, insufficient funds, ownership
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { testPrisma, cleanDatabase, uid } from './helpers'
import { AuthService } from '../../modules/auth/auth.service'
import { CharactersService } from '../../modules/characters/characters.service'
import { GovernmentShopService } from '../../modules/government-shop/government-shop.service'
import { AppError } from '../../shared/errors/app-error'

beforeAll(async () => { await testPrisma.$connect() })
afterAll(async () => { await testPrisma.$disconnect() })
beforeEach(async () => { await cleanDatabase() })

async function createCharacterWithTemplate() {
  const login = uid('shop_user')
  const { id: userId } = await AuthService.register({
    login, email: `${login}@t.com`, password: 'pass',
  })
  const char = await CharactersService.create(userId, {
    nickname: uid('ShopChar'), archetype: 'WORKER',
  })

  // Create an item template and shop entry for testing
  const template = await testPrisma.itemTemplate.create({
    data: {
      code: uid('tpl'),
      name: 'Test Knife',
      type: 'WEAPON',
      weaponType: 'KNIFE',
      minDamage: 4, maxDamage: 9,
      weight: 0.5,
      durabilityMax: 80,
      priceBase: 200,
      sourceType: 'GOVERNMENT',
    },
  })

  const shopEntry = await testPrisma.governmentShopItem.create({
    data: { templateId: template.id, isAvailable: true },
  })

  return { userId, char: char!, template, shopEntry }
}

// ---------------------------------------------------------------
// List items
// ---------------------------------------------------------------
describe('GovernmentShopService.listItems', () => {
  it('returns only available items', async () => {
    const { template } = await createCharacterWithTemplate()

    const items = await GovernmentShopService.listItems()
    const found = items.find(i => i.templateId === template.id)
    expect(found).toBeDefined()
    expect(found!.isAvailable).toBe(true)
  })

  it('hides unavailable items', async () => {
    const tpl = await testPrisma.itemTemplate.create({
      data: {
        code: uid('hidden_tpl'),
        name: 'Hidden Item',
        type: 'WEAPON',
        weaponType: 'CLUB',
        weight: 1,
        durabilityMax: 50,
        priceBase: 100,
        sourceType: 'GOVERNMENT',
      },
    })
    await testPrisma.governmentShopItem.create({
      data: { templateId: tpl.id, isAvailable: false },
    })

    const items = await GovernmentShopService.listItems()
    const found = items.find(i => i.templateId === tpl.id)
    expect(found).toBeUndefined()
  })
})

// ---------------------------------------------------------------
// Buy
// ---------------------------------------------------------------
describe('GovernmentShopService.buy', () => {
  it('deducts money and creates item instance', async () => {
    const { char, template } = await createCharacterWithTemplate()

    const moneyBefore = char.money
    const result = await GovernmentShopService.buy(char.id, template.id, uid("key"))

    expect(result.newBalance).toBe(moneyBefore - template.priceBase)
    expect(result.item.ownerId).toBe(char.id)
    expect(result.item.templateId).toBe(template.id)
    expect(result.item.durabilityCurrent).toBe(template.durabilityMax)

    // Verify in DB
    const updated = await testPrisma.character.findUnique({ where: { id: char.id } })
    expect(updated!.money).toBe(moneyBefore - template.priceBase)
  })

  it('initializes consumable tool uses from the template', async () => {
    const { char } = await createCharacterWithTemplate()
    const tool = await testPrisma.itemTemplate.create({
      data: { code: uid('tool'), name: 'Work tool', type: 'TOOL', toolTier: 2, usesMax: 50, weight: 1, durabilityMax: 1, priceBase: 200, isEquippable: false },
    })
    await testPrisma.governmentShopItem.create({ data: { templateId: tool.id, isAvailable: true } })

    const bought = await GovernmentShopService.buy(char.id, tool.id, uid("key"))

    expect(bought.item.usesLeft).toBe(50)
    expect(bought.item.status).toBe('NORMAL')
  })

  it('writes currency log on purchase', async () => {
    const { char, template } = await createCharacterWithTemplate()
    await GovernmentShopService.buy(char.id, template.id, uid("key"))

    const log = await testPrisma.currencyLog.findFirst({
      where: { characterId: char.id, reasonCode: 'SHOP_PURCHASE' },
    })
    expect(log).not.toBeNull()
    expect(log!.amount).toBe(-template.priceBase)
  })

  it('writes item log on purchase', async () => {
    const { char, template } = await createCharacterWithTemplate()
    const { item } = await GovernmentShopService.buy(char.id, template.id, uid("key"))

    const log = await testPrisma.itemLog.findFirst({
      where: { itemId: item.id, actionCode: 'CREATED_FROM_SHOP' },
    })
    expect(log).not.toBeNull()
  })

  it('throws 400 if insufficient funds', async () => {
    const { char, template } = await createCharacterWithTemplate()
    // Drain character's money
    await testPrisma.character.update({ where: { id: char.id }, data: { money: 0 } })

    await expect(
      GovernmentShopService.buy(char.id, template.id, uid("key"))
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.statusCode === 400)
  })

  it('throws 404 if template not in shop', async () => {
    const { char } = await createCharacterWithTemplate()
    const randomId = '00000000-0000-0000-0000-000000000000'

    await expect(
      GovernmentShopService.buy(char.id, randomId, uid("key"))
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && (e.statusCode === 404 || e.statusCode === 400))
  })

  it('is atomic — money not deducted if item creation fails', async () => {
    // This test validates transaction integrity
    const { char, template } = await createCharacterWithTemplate()
    const moneyBefore = char.money

    // Mark template as inactive mid-test (simulating race condition)
    await testPrisma.itemTemplate.update({
      where: { id: template.id },
      data: { isActive: false },
    })

    try {
      await GovernmentShopService.buy(char.id, template.id, uid("key"))
    } catch (_e) {
      // Expected to fail
    }

    const updated = await testPrisma.character.findUnique({ where: { id: char.id } })
    expect(updated!.money).toBe(moneyBefore) // Money must NOT have been deducted
  })
})

// ---------------------------------------------------------------
// Sell
// ---------------------------------------------------------------
describe('GovernmentShopService.sell', () => {
  it('returns 50% of base price', async () => {
    const { char, template } = await createCharacterWithTemplate()
    const { item } = await GovernmentShopService.buy(char.id, template.id, uid("key"))

    const charAfterBuy = await testPrisma.character.findUnique({ where: { id: char.id } })
    const moneyBeforeSell = charAfterBuy!.money

    const expectedReturn = Math.floor(template.priceBase * 0.5)
    const result = await GovernmentShopService.sell(char.id, item.id)

    expect(result.sellPrice).toBe(expectedReturn)
    expect(result.newBalance).toBe(moneyBeforeSell + expectedReturn)
  })

  it('deletes item after sell', async () => {
    const { char, template } = await createCharacterWithTemplate()
    const { item } = await GovernmentShopService.buy(char.id, template.id, uid("key"))
    await GovernmentShopService.sell(char.id, item.id)

    const itemInDb = await testPrisma.itemInstance.findUnique({ where: { id: item.id } })
    expect(itemInDb!.status).toBe('DELETED')
  })

  it('throws 403 if item not owned', async () => {
    const { template } = await createCharacterWithTemplate()

    // Create a second character
    const login2 = uid('other_user')
    const { id: userId2 } = await AuthService.register({
      login: login2, email: `${login2}@t.com`, password: 'pass',
    })
    const char2 = await CharactersService.create(userId2, {
      nickname: uid('Other'), archetype: 'WORKER',
    })

    // Buy item with char2 but try to sell with first char
    const { char: char1 } = await createCharacterWithTemplate()
    const { item } = await GovernmentShopService.buy(char2!.id, template.id)

    await expect(
      GovernmentShopService.sell(char1.id, item.id)
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.statusCode === 403)
  })
})

// ---------------------------------------------------------------
// Идемпотентность и защита от повторного начисления
// ---------------------------------------------------------------
describe('GovernmentShopService — повторы не создают денег из воздуха', () => {
  it('повтор buy с тем же ключом не создаёт вторую вещь и не списывает дважды', async () => {
    const { char, template } = await createCharacterWithTemplate()
    const moneyBefore = char.money
    const key = uid('buy-key')

    const first = await GovernmentShopService.buy(char.id, template.id, key)
    const replay = await GovernmentShopService.buy(char.id, template.id, key)

    // Тот же результат, помеченный как повтор.
    expect(replay.item.id).toBe(first.item.id)
    expect((replay as { replayed?: boolean }).replayed).toBe(true)

    // Списано ровно один раз, вещь создана одна.
    const updated = await testPrisma.character.findUniqueOrThrow({ where: { id: char.id } })
    expect(updated.money).toBe(moneyBefore - template.priceBase)
    expect(await testPrisma.itemInstance.count({ where: { ownerId: char.id, templateId: template.id } })).toBe(1)
  })

  it('повтор sell не начисляет деньги дважды за одну вещь', async () => {
    const { char, template } = await createCharacterWithTemplate()
    const { item } = await GovernmentShopService.buy(char.id, template.id, uid('buy-key'))

    const afterBuy = await testPrisma.character.findUniqueOrThrow({ where: { id: char.id } })
    const first = await GovernmentShopService.sell(char.id, item.id)
    const afterSell = await testPrisma.character.findUniqueOrThrow({ where: { id: char.id } })
    expect(afterSell.money).toBe(afterBuy.money + first.sellPrice)

    // Второй sell той же вещи должен упасть, а не заплатить снова.
    await expect(GovernmentShopService.sell(char.id, item.id))
      .rejects.toSatisfy((e: unknown) => e instanceof AppError && e.statusCode === 409)

    const afterSecond = await testPrisma.character.findUniqueOrThrow({ where: { id: char.id } })
    expect(afterSecond.money).toBe(afterSell.money)
  })
})
