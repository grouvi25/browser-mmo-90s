/**
 * Выдача и списание ресурсов из карточки игрока (Дима 07.11: «как выдавать
 * какие-то ресы, вещи?»). Как и всё в админке — с причиной и откатом.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AdminActionsService } from '../../modules/admin-actions/admin-actions.service'
import { cleanDatabase, testPrisma, uid } from './helpers'

const REASON = 'тест крафта свитка по просьбе'

describe('выдача ресурсов админом', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  async function setup() {
    const login = uid('res')
    const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
    const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80 } })
    const resource = await testPrisma.resourceTemplate.create({ data: { code: uid('paper'), name: 'Бумага льняная', category: 'PRIMARY', tier: 1, basePrice: 10, weight: .1 } })
    const row = await testPrisma.adminUser.create({ data: { username: uid('adm'), passwordHash: 'x', role: 'SUPER_ADMIN' } })
    return { character, resource, ctx: { adminId: row.id, adminRole: row.role } }
  }
  const amountOf = async (characterId: string, resourceTemplateId: string) =>
    (await testPrisma.resourceStack.findUnique({ where: { characterId_resourceTemplateId: { characterId, resourceTemplateId } } }))?.amount ?? 0

  it('выдаёт ресурс с записью в журнале и откатывает обратно', async () => {
    const { character, resource, ctx } = await setup()
    const payload = { characterId: character.id, resourceTemplateId: resource.id, amount: 2 }
    const granted = await AdminActionsService.perform(ctx, REASON, {
      kind: 'GRANT_RESOURCE', payload, targetType: 'character', targetId: character.id,
      undo: { kind: 'TAKE_RESOURCE', payload },
    })
    expect(await amountOf(character.id, resource.id)).toBe(2)
    expect(await testPrisma.resourceLog.count({ where: { characterId: character.id, reasonCode: 'ADMIN_ADJUSTMENT' } })).toBe(1)
    await AdminActionsService.rollback(ctx, granted.actionId, 'выдал не тому игроку')
    expect(await amountOf(character.id, resource.id)).toBe(0)
  })

  it('забрать больше свободного нельзя: выставленное на рынок не трогаем', async () => {
    const { character, resource, ctx } = await setup()
    await testPrisma.resourceStack.create({ data: { characterId: character.id, resourceTemplateId: resource.id, amount: 5, reservedAmount: 4 } })
    const payload = { characterId: character.id, resourceTemplateId: resource.id, amount: 2 }
    await expect(AdminActionsService.perform(ctx, REASON, {
      kind: 'TAKE_RESOURCE', payload, targetType: 'character', targetId: character.id,
      undo: { kind: 'GRANT_RESOURCE', payload },
    })).rejects.toMatchObject({ statusCode: 409 })
    expect(await amountOf(character.id, resource.id)).toBe(5)
  })
})
