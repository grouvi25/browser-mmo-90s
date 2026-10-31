import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import { BalanceConfig } from '../../config/balance.config'
import { CHARM_KEYS, EMPTY_GEAR, charmBalance, gearOf, hpWithGear, masteryBalance, type ItemBonuses } from '../../modules/items/gear-bonuses'
import { calcHpMax } from '../../modules/stats/stats.formulas'
import { ItemStatsService } from '../../modules/items/item-stats.service'
import { applyUpgradeModifiers } from '../../modules/upgrades/upgrades.formulas'
import { cleanDatabase, testPrisma, uid } from './helpers'

const none = (): ItemBonuses => ({ stats: {}, mastery: {}, minusMastery: {}, charms: {}, minusCharms: {} })

async function named(opts: { type?: 'WEAPON' | 'ARMOR' | 'ACCESSORY'; budget?: number; dollars?: number; tsum?: boolean } = {}) {
  const login = uid('named')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, dollars: opts.dollars ?? 0, stats: { create: {} } },
  })
  const type = opts.type ?? 'ARMOR'
  const template = await testPrisma.itemTemplate.create({
    data: {
      code: uid('tpl'), name: 'Именная вещь', type, armor: type === 'WEAPON' ? null : 3, minDamage: type === 'WEAPON' ? 0 : null, maxDamage: type === 'WEAPON' ? 0 : null,
      armorSlot: type === 'ARMOR' ? 'CHEST' : type === 'ACCESSORY' ? 'ACCESSORY' : null, weaponType: type === 'WEAPON' ? 'KNIFE' : null,
      allocationMode: 'PLAYER', statBudget: opts.budget ?? 100, sourceType: 'DONATE',
    },
  })
  if (opts.tsum !== false) await testPrisma.dollarShopItem.create({ data: { shop: 'TSUM', templateId: template.id, priceDollars: 2000 } })
  const item = await testPrisma.itemInstance.create({
    data: { templateId: template.id, ownerId: character.id, quality: 'COMMON', durabilityCurrent: 100, durabilityMax: 100, weight: 1, sourceType: 'DONATE', freePoints: opts.budget ?? 100 },
  })
  return { character, item, template }
}

describe('Именные вещи: столбики, уровни, картинка', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  it('очко всегда что-то добавляет: броня 3 и урон 0 растут', () => {
    expect(applyUpgradeModifiers({ armor: 3, durabilityMax: 100 }, { ARMOR: 1 }).armor).toBe(4)
    expect(applyUpgradeModifiers({ minDamage: 0, maxDamage: 0, durabilityMax: 100 }, { DAMAGE: 2 }).maxDamage).toBe(2)
    // Большая база считается процентом, как раньше.
    expect(applyUpgradeModifiers({ armor: 100, durabilityMax: 100 }, { ARMOR: 2 }).armor).toBe(112)
  })

  it('сохраняет весь расклад: минус на стате и минус-оберег не возвращают очки', async () => {
    const { character, item } = await named({ tsum: false })
    const bonuses = {
      ...none(), stats: { str: 20, agi: -5, rea: 3 }, mastery: { fist: 5 }, minusMastery: { defense: 2 },
      charms: { antiDodge: 5 }, minusCharms: { antiDodge: 5 },
    }
    const saved = await ItemStatsService.configure(character.id, item.id, { ARMOR: 10 }, bonuses)
    expect(saved).toMatchObject({ freePoints: 100 - (10 + 20 + 5 + 3 + 5 + 2 + 5 + 5), budget: 100 })

    const row = await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: item.id }, include: { template: true } })
    const gear = gearOf([row])
    expect(gear.stats).toMatchObject({ str: 20, agi: -5, rea: 3 })
    // На одной вещи оберег сразу и в плюс, и в минус.
    // Очко мастерства или оберега — 5%, и в плюс, и в минус.
    expect(gear.antiDodge).toBeCloseTo(0.25)
    expect(gear.minus.antiDodge).toBeCloseTo(0.25)
    expect(gear.mastery.fist).toBeCloseTo(0.25)
    expect(gear.minusMastery.defense).toBeCloseTo(0.1)
    expect(applyUpgradeModifiers(row.template, {}, row.statAllocation).armor).toBe(13)
  })

  it('у вещи ЦУМа нет блока «Сама вещь»', async () => {
    const { character, item } = await named()
    await expect(ItemStatsService.configure(character.id, item.id, { ARMOR: 1 }, none())).rejects.toMatchObject({ statusCode: 422 })
    await expect(ItemStatsService.allocate(character.id, item.id, 'ARMOR', 1)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('предела на поле нет: все очки можно вложить в один стат, плюс или минус', async () => {
    const { character, item } = await named()
    const read = async () => gearOf([await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: item.id }, include: { template: true } })])

    expect((await ItemStatsService.configure(character.id, item.id, {}, { ...none(), charms: { antiDodge: 100 } })).freePoints).toBe(0)
    expect((await read()).antiDodge).toBeCloseTo(5)
    await ItemStatsService.configure(character.id, item.id, {}, { ...none(), minusCharms: { antiDodge: 100 } })
    expect((await read()).minus.antiDodge).toBeCloseTo(5)
    await ItemStatsService.configure(character.id, item.id, {}, { ...none(), stats: { str: 100 } })
    expect((await read()).stats.str).toBe(100)
    await ItemStatsService.configure(character.id, item.id, {}, { ...none(), stats: { agi: -100 } })
    expect((await read()).stats.agi).toBe(-100)
    await expect(ItemStatsService.configure(character.id, item.id, {}, { ...none(), stats: { str: 101 } })).rejects.toThrow('Расставлено 101 очков из 100')
  })

  it('минус 3000 против оберега 3500: в бою остаётся разница', () => {
    const scale = BalanceConfig.economy.namedItems.percentPerPoint
    const wearer = (bonuses: ItemBonuses) => gearOf([{ id: uid('i'), bonuses, template: { type: 'ARMOR' } }])
    const defender = wearer({ ...none(), charms: { antiDodge: 3500 / scale } })
    const attacker = wearer({ ...none(), minusCharms: { antiDodge: 3000 / scale } })
    expect(charmBalance(defender.antiDodge, attacker.minus.antiDodge)).toBeCloseTo(5)
    expect(charmBalance(attacker.antiDodge, defender.minus.antiDodge)).toBe(0)
  })

  it('выносливость с вещи даёт 5 здоровья, своя — 6', async () => {
    const { character, item } = await named()
    await ItemStatsService.configure(character.id, item.id, {}, { ...none(), stats: { end: 10 } })
    const row = await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: item.id }, include: { template: true } })
    const gear = gearOf([row])
    expect(hpWithGear(3, 1, gear)).toBe(calcHpMax(3, 1) + 50)
    expect(hpWithGear(2, 1, { ...gear, stats: { ...gear.stats, end: -5 } })).toBe(calcHpMax(2, 1) - 10)
  })

  it('расклад можно переделать, но не больше бюджета', async () => {
    const { character, item } = await named({ budget: 10 })
    await ItemStatsService.configure(character.id, item.id, {}, { ...none(), stats: { str: 10 } })
    await expect(ItemStatsService.configure(character.id, item.id, {}, { ...none(), stats: { str: 8, end: 3 } }))
      .rejects.toThrow('Расставлено 11 очков из 10')
    const again = await ItemStatsService.configure(character.id, item.id, {}, { ...none(), stats: { end: 4 } })
    expect(again.freePoints).toBe(6)
  })

  it('кольцо настраивается: раньше очки в него было не вложить', async () => {
    const { character, item } = await named({ type: 'ACCESSORY', budget: 100 })
    await expect(ItemStatsService.configure(character.id, item.id, { ARMOR: 1 }, none())).rejects.toMatchObject({ statusCode: 422 })
    const saved = await ItemStatsService.configure(character.id, item.id, {}, { ...none(), charms: { antiLuck: 10 } })
    expect(saved.freePoints).toBe(90)
  })

  it('в бою и на рынке вещь не настраивается', async () => {
    const { character, item } = await named()
    await testPrisma.itemInstance.update({ where: { id: item.id }, data: { status: 'ON_MARKET' } })
    await expect(ItemStatsService.configure(character.id, item.id, {}, none())).rejects.toThrow('на рынок')
    await testPrisma.itemInstance.update({ where: { id: item.id }, data: { status: 'NORMAL' } })
    await testPrisma.character.update({ where: { id: character.id }, data: { status: 'IN_BATTLE' } })
    await expect(ItemStatsService.configure(character.id, item.id, {}, none())).rejects.toThrow('боя')
  })

  it('уровень вещи: +50 очков за доллары, один раз на ключ, не выше потолка', async () => {
    const price = BalanceConfig.economy.namedItems.levelPriceUsd
    const { character, item } = await named({ dollars: price * 2 })
    const key = randomUUID()
    const up = await ItemStatsService.levelUp(character.id, item.id, key)
    expect(up).toMatchObject({ namedLevel: 1, freePoints: 150, dollars: price })
    expect(await ItemStatsService.levelUp(character.id, item.id, key)).toMatchObject({ namedLevel: 1 })
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).dollars).toBe(price)

    const saved = await ItemStatsService.configure(character.id, item.id, {}, { ...none(), stats: { str: 50, end: 50, agi: 50 } })
    expect(saved).toMatchObject({ budget: 150, freePoints: 0 })

    await testPrisma.itemInstance.update({ where: { id: item.id }, data: { namedLevel: BalanceConfig.economy.namedItems.maxLevel } })
    await expect(ItemStatsService.levelUp(character.id, item.id, randomUUID())).rejects.toThrow('последний уровень')
  })

  it('уровень и картинка — только у вещей ЦУМа', async () => {
    const { character, item } = await named({ tsum: false, dollars: 5000 })
    await expect(ItemStatsService.levelUp(character.id, item.id, randomUUID())).rejects.toThrow('именных')
    await expect(ItemStatsService.setIcon(character.id, item.id, 'data:image/png;base64,AAAA')).rejects.toThrow('ЦУМа')
  })

  it('своя картинка: сохраняется, отдаётся и меняет версию', async () => {
    const { character, item } = await named()
    await expect(ItemStatsService.setIcon(character.id, item.id, 'data:text/html;base64,AAAA')).rejects.toMatchObject({ statusCode: 422 })
    expect(await ItemStatsService.setIcon(character.id, item.id, 'data:image/png;base64,AAAA')).toMatchObject({ iconVersion: 1 })
    expect(await ItemStatsService.setIcon(character.id, item.id, 'data:image/webp;base64,BBBB')).toMatchObject({ iconVersion: 2 })
    expect((await ItemStatsService.icon(item.id))?.mime).toBe('image/webp')
    expect(await ItemStatsService.icon(randomUUID())).toBeNull()
  })

  it('минус-мастерство срезает мастерство противника, не ниже нуля', () => {
    const mine = { ...EMPTY_GEAR, mastery: { ...EMPTY_GEAR.mastery, weapon: 0.1 } }
    const foe = { ...EMPTY_GEAR, minusMastery: { ...EMPTY_GEAR.minusMastery, weapon: 0.04 } }
    expect(masteryBalance(mine, foe, 'weapon')).toBeCloseTo(0.06)
    expect(masteryBalance(mine, { ...foe, minusMastery: { ...foe.minusMastery, weapon: 0.5 } }, 'weapon')).toBe(0)
  })

  it('минус-обереги и мастерства вещи из админки работают вместе со старыми колонками', () => {
    const gear = gearOf([{
      id: 'x',
      template: { type: 'ARMOR', antiDodge: 0.03, antiLuck: -0.04, extraBonuses: { minusCharms: { antiDodge: 2 }, mastery: { accuracy: 6 } } },
    }])
    expect(gear.antiDodge).toBeCloseTo(0.03)
    expect(gear.minus.antiDodge).toBeCloseTo(0.02)
    expect(gear.minus.antiLuck).toBeCloseTo(0.04)
    expect(gear.mastery.accuracy).toBeCloseTo(0.06)
    expect(CHARM_KEYS).toHaveLength(4)
  })
})
