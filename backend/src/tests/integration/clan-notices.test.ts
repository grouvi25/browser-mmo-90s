/**
 * Правки заказчика (19 октября 2026): журнал склада бригады для главы и
 * зама, личные уведомления в чате, должность — только по «Сохранить».
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ClansService } from '../../modules/clans/clans.service'
import { NoticesService } from '../../modules/chat/notices.service'
import { NOTICE_RULES } from '../../modules/chat/notices.hook'
import { cleanDatabase, testPrisma, uid, paidClan } from './helpers'

async function player(prefix: string) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money: 100_000, battleLevel: 5 },
  })
}

describe('журнал склада и уведомления', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  async function brigade() {
    const boss = await player('boss')
    const clan = await paidClan(boss.id, uid('clan').slice(0, 30), Math.random().toString(36).slice(2, 6).toUpperCase())
    const roles = await testPrisma.clanRole.findMany({ where: { clanId: clan.id } })
    const byCode = (code: string) => roles.find(r => r.code === code)!
    const join = async (prefix: string, code: string) => {
      const p = await player(prefix)
      await testPrisma.clanMember.create({ data: { clanId: clan.id, characterId: p.id, roleId: byCode(code).id } })
      await testPrisma.character.update({ where: { id: p.id }, data: { clanId: clan.id } })
      return p
    }
    await testPrisma.resourceTemplate.upsert({
      where: { code: 'res_greens' }, update: {},
      create: { code: 'res_greens', name: 'Зелень', category: 'PRIMARY', tier: 1, basePrice: 20, weight: 0.1 },
    })
    return { boss, clan, byCode, join }
  }
  const give = async (characterId: string, amount: number) => {
    const tpl = await testPrisma.resourceTemplate.findUniqueOrThrow({ where: { code: 'res_greens' } })
    await testPrisma.resourceStack.upsert({
      where: { characterId_resourceTemplateId: { characterId, resourceTemplateId: tpl.id } },
      update: { amount }, create: { characterId, resourceTemplateId: tpl.id, amount },
    })
  }

  it('склад пишет, кто что положил и взял; журнал видят глава и бригадир, а не боец', async () => {
    const { boss, join } = await brigade()
    const fighter = await join('fighter', 'fighter')
    const deputy = await join('deputy', 'brigadier')
    await give(fighter.id, 10)

    await ClansService.depositStorage(fighter.id, 'res_greens', 6)
    await ClansService.withdrawStorage(fighter.id, 'res_greens', 2)

    const log = await ClansService.storageLog(boss.id)
    expect(log.items).toHaveLength(2)
    expect(log.items.map(r => r.amount).sort((a, b) => a - b)).toEqual([-2, 6])
    expect(log.items[0]).toMatchObject({ nickname: fighter.nickname, resource: 'Зелень' })
    expect((await ClansService.storageLog(deputy.id)).items).toHaveLength(2)
    await expect(ClansService.storageLog(fighter.id)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('смена должности возвращает название роли для уведомления и не шлёт его, если роль та же', async () => {
    const { boss, byCode, join } = await brigade()
    const fighter = await join('fighter2', 'fighter')
    const same = await ClansService.assignRole(boss.id, fighter.id, byCode('fighter').id)
    expect(same.changed).toBe(false)
    const changed = await ClansService.assignRole(boss.id, fighter.id, byCode('brigadier').id)
    expect(changed).toMatchObject({ changed: true, roleName: 'Бригадир' })
  })

  it('личные уведомления видит только адресат, свежие, по порядку', async () => {
    const a = await player('na')
    const b = await player('nb')
    await NoticesService.push(a.id, 'Вы посадили: Укроп.')
    await NoticesService.push(a.id, 'Вы полили грядку.')
    await NoticesService.push(b.id, 'Чужое уведомление.')
    await testPrisma.gameNotice.create({ data: { characterId: a.id, text: 'Давнее', createdAt: new Date(Date.now() - 48 * 3_600_000) } })

    const mine = await NoticesService.list(a.id)
    expect(mine.map(n => n.text)).toEqual(['Вы посадили: Укроп.', 'Вы полили грядку.'])
    expect((await NoticesService.list(b.id)).map(n => n.text)).toEqual(['Чужое уведомление.'])
  })

  it('таблица уведомлений покрывает ферму, работу, покупки и не дублирует маршруты', () => {
    const keys = NOTICE_RULES.map(r => `${r.method} ${r.url}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const needed of ['POST /api/farm/plots/:id/plant', 'POST /api/farm/plots/:id/harvest', 'POST /api/work/shifts/start',
      'POST /api/work/shifts/:shiftId/claim', 'POST /api/shops/government/buy', 'POST /api/market/listings/:listingId/buy']) {
      expect(keys).toContain(needed)
    }
    const plant = NOTICE_RULES.find(r => r.url.endsWith('/plant'))!
    expect(plant.text({ cropCode: 'dill' }, {})).toBe('Вы посадили: Укроп.')
    expect(NOTICE_RULES.find(r => r.url.endsWith('/claim'))!.text({}, { salary: 1234 })).toMatch(/^Смена закрыта: получено 1.234 ₽\.$/)
  })
})
