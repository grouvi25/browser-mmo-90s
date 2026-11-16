/**
 * Обращение №131 (Monnarhh 16.11): «Сломанная вещь не падает в сумку пока
 * сам не снимешь». Износ до нуля теперь сам снимает вещь: в сумке её можно
 * сразу нести в ремонт, а в бою она больше не числится надетой.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ItemsRepository } from '../../modules/items/item-instance.repository'
import { cleanDatabase, testPrisma, uid } from './helpers'

describe('сломанная вещь уходит в сумку (№131)', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(cleanDatabase)
  afterAll(async () => testPrisma.$disconnect())

  it('износ до нуля снимает вещь, ненулевой износ — нет', async () => {
    const login = uid('broken')
    const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
    const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'WORKER', hpCurrent: 80, hpMax: 80 } })
    const template = await testPrisma.itemTemplate.create({ data: { code: uid('vest'), name: 'Жилет', type: 'ARMOR', armorSlot: 'CHEST', weight: 1, durabilityMax: 10, priceBase: 100 } })
    const item = await testPrisma.itemInstance.create({ data: { templateId: template.id, ownerId: character.id, durabilityCurrent: 3, durabilityMax: 10, weight: 1, sourceType: 'GOVERNMENT', isEquipped: true, status: 'EQUIPPED', armorSlot: 'CHEST' } })

    await ItemsRepository.updateDurability(item.id, 1)
    expect(await testPrisma.itemInstance.findUnique({ where: { id: item.id } })).toMatchObject({ durabilityCurrent: 1, isEquipped: true, status: 'EQUIPPED', armorSlot: 'CHEST' })

    await ItemsRepository.updateDurability(item.id, 0)
    expect(await testPrisma.itemInstance.findUnique({ where: { id: item.id } })).toMatchObject({ durabilityCurrent: 0, isEquipped: false, status: 'BROKEN', armorSlot: null })
    expect(await ItemsRepository.findEquipped(character.id)).toEqual([])
  })
})
