import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ClansService } from '../../modules/clans/clans.service'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function player(prefix: string, money = 100_000, battleLevel = 5) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money, battleLevel },
  })
}

async function clanWithBoss(prefix = 'boss') {
  const boss = await player(prefix)
  const name = uid(`${prefix}-clan`)
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase()
  const clan = await ClansService.create(boss.id, name, tag)
  return { boss, clan }
}

describe('clans', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  it('creates a clan for 25000, requires battle level 5 and seeds four default roles', async () => {
    const low = await player('lowlevel', 100_000, 4)
    await expect(ClansService.create(low.id, 'Too Young', 'TY')).rejects.toThrow()

    const boss = await player('founder')
    const clan = await ClansService.create(boss.id, 'Кооператив', 'COOP')
    const bossAfter = await testPrisma.character.findUniqueOrThrow({ where: { id: boss.id } })
    expect(bossAfter.money).toBe(100_000 - 25_000)
    expect(bossAfter.clanId).toBe(clan.id)

    const roles = await testPrisma.clanRole.findMany({ where: { clanId: clan.id } })
    expect(roles.map(role => role.code).sort()).toEqual(['boss', 'brigadier', 'fighter', 'infantry'])
    const bossRole = roles.find(role => role.code === 'boss')!
    expect(bossRole.permissions).toContain('ASSIGN_ROLE')
  })

  it('приглашение по нику видно приглашённому; отказ и повторные приглашения не ломаются', async () => {
    const { boss, clan } = await clanWithBoss()
    const recruit = await player('nick')
    await expect(ClansService.invite(boss.id, { nickname: 'нет-такого' })).rejects.toThrow('не найден')
    await expect(ClansService.invite(boss.id, { nickname: boss.nickname })).rejects.toThrow('Себя')

    const first = await ClansService.invite(boss.id, { nickname: recruit.nickname.toUpperCase() })
    expect(first.characterId).toBe(recruit.id)
    const inbox = await ClansService.myInvites(recruit.id)
    expect(inbox).toHaveLength(1)
    expect(inbox[0]).toMatchObject({ id: first.id, clan: { id: clan.id }, invitedBy: boss.nickname })

    await ClansService.decline(recruit.id, first.id)
    expect(await ClansService.myInvites(recruit.id)).toHaveLength(0)
    // Раньше третье приглашение тому же бойцу падало на уникальном индексе.
    await ClansService.invite(boss.id, { nickname: recruit.nickname })
    await ClansService.invite(boss.id, { nickname: recruit.nickname })
    const last = await ClansService.invite(boss.id, { nickname: recruit.nickname })
    expect(await ClansService.myInvites(recruit.id)).toHaveLength(1)
    expect((await ClansService.accept(recruit.id, last.id)).clanId).toBe(clan.id)
  })

  it('бригада регистрируется без тега: тег выдаётся сам, название уникально', async () => {
    const boss = await player('notag')
    const name = uid('без-тега')
    const clan = await ClansService.create(boss.id, name)
    expect(clan.tag).toMatch(/^[A-Z0-9]{4}$/)
    const other = await player('dup')
    await expect(ClansService.create(other.id, name.toUpperCase())).rejects.toThrow('уже есть')
  })

  it('иконку ставит глава: картинка отдаётся отдельно, в карточке — только версия', async () => {
    const { boss, clan } = await clanWithBoss()
    const recruit = await player('icon-r')
    const invite = await ClansService.invite(boss.id, { characterId: recruit.id })
    await ClansService.accept(recruit.id, invite.id)
    const png = 'data:image/png;base64,' + Buffer.from('fake-png-bytes').toString('base64')
    await expect(ClansService.setIcon(recruit.id, png)).rejects.toThrow()
    await expect(ClansService.setIcon(boss.id, 'data:text/html;base64,PGI+')).rejects.toThrow('PNG')
    const saved = await ClansService.setIcon(boss.id, png)
    expect(saved.iconVersion).toBe(1)
    const icon = await ClansService.icon(clan.id)
    expect(icon?.mime).toBe('image/png')
    expect(icon?.bytes.toString()).toBe('fake-png-bytes')
    const card = await ClansService.get(clan.id) as Record<string, unknown>
    expect(card.iconData).toBeUndefined()
    expect(card.iconVersion).toBe(1)
    expect((await ClansService.list()).find(c => c.id === clan.id)?.iconVersion).toBe(1)
  })

  it('invites, accepts and assigns a role to the correct target member (not the actor)', async () => {
    const { boss, clan } = await clanWithBoss()
    const recruit = await player('recruit')
    const invite = await ClansService.invite(boss.id, { characterId: recruit.id })
    const accepted = await ClansService.accept(recruit.id, invite.id)
    expect(accepted.clanId).toBe(clan.id)

    const brigadierRole = await testPrisma.clanRole.findFirstOrThrow({ where: { clanId: clan.id, code: 'brigadier' } })
    await ClansService.assignRole(boss.id, recruit.id, brigadierRole.id)

    const recruitMember = await testPrisma.clanMember.findUniqueOrThrow({ where: { characterId: recruit.id } })
    expect(recruitMember.roleId).toBe(brigadierRole.id)
    // раньше assignRole искал строку по characterId вызывающего, а не цели —
    // роль босса не должна была измениться этим вызовом.
    const bossMember = await testPrisma.clanMember.findUniqueOrThrow({ where: { characterId: boss.id } })
    const bossRole = await testPrisma.clanRole.findUniqueOrThrow({ where: { id: bossMember.roleId } })
    expect(bossRole.code).toBe('boss')
  })

  it('deposits to treasury, pays off maintenance debt first and unfreezes the clan', async () => {
    const { boss, clan } = await clanWithBoss()
    await testPrisma.clan.update({ where: { id: clan.id }, data: { maintenanceDebt: 1000, isFrozen: true } })
    const result = await ClansService.depositTreasury(boss.id, 1500)
    expect(result.debt).toBe(0)
    expect(result.treasury).toBe(500) // 1500 - 1000 долга
    const clanAfter = await testPrisma.clan.findUniqueOrThrow({ where: { id: clan.id } })
    expect(clanAfter.isFrozen).toBe(false)
  })

  it('caps brigadier daily treasury spend and blocks a frozen clan from spending', async () => {
    const { boss, clan } = await clanWithBoss()
    await ClansService.depositTreasury(boss.id, 50_000)
    const recruit = await player('spender')
    const invite = await ClansService.invite(boss.id, { characterId: recruit.id })
    await ClansService.accept(recruit.id, invite.id)
    const brigadierRole = await testPrisma.clanRole.findFirstOrThrow({ where: { clanId: clan.id, code: 'brigadier' } })
    await ClansService.assignRole(boss.id, recruit.id, brigadierRole.id)

    await expect(ClansService.spendTreasury(recruit.id, 20_001, 'test')).rejects.toThrow() // выше 20000 бригадира в сутки
    const spent = await ClansService.spendTreasury(recruit.id, 20_000, 'supplies')
    expect(spent.treasury).toBe(50_000 - 20_000)

    await testPrisma.clan.update({ where: { id: clan.id }, data: { isFrozen: true } })
    await expect(ClansService.spendTreasury(boss.id, 100, 'test')).rejects.toThrow()
  })

  it('deposits and withdraws clan storage within the role daily limit', async () => {
    const { boss, clan } = await clanWithBoss()
    await testPrisma.resourceTemplate.upsert({
      where: { code: 'res_scrap_metal' }, update: {},
      create: { code: 'res_scrap_metal', name: 'Металлолом', category: 'PRIMARY', tier: 1, basePrice: 8, weight: 0.5 },
    })
    const template = await testPrisma.resourceTemplate.findUniqueOrThrow({ where: { code: 'res_scrap_metal' } })
    await testPrisma.resourceStack.create({ data: { characterId: boss.id, resourceTemplateId: template.id, amount: 50 } })

    await ClansService.depositStorage(boss.id, 'res_scrap_metal', 20)
    const stored = await testPrisma.clanStorage.findUniqueOrThrow({ where: { clanId_resourceCode: { clanId: clan.id, resourceCode: 'res_scrap_metal' } } })
    expect(stored.amount).toBe(20)

    // босс не ограничен суточным лимитом выноса (Number.MAX_SAFE_INTEGER в формуле)
    await ClansService.withdrawStorage(boss.id, 'res_scrap_metal', 5)
    const stack = await testPrisma.resourceStack.findFirstOrThrow({ where: { characterId: boss.id, resourceTemplateId: template.id } })
    expect(stack.amount).toBe(50 - 20 + 5)
  })

  it('lets a member leave and a boss neither leave nor be kicked directly', async () => {
    const { boss, clan } = await clanWithBoss()
    const recruit = await player('leaver')
    const invite = await ClansService.invite(boss.id, { characterId: recruit.id })
    await ClansService.accept(recruit.id, invite.id)

    await ClansService.leave(recruit.id)
    const left = await testPrisma.character.findUniqueOrThrow({ where: { id: recruit.id } })
    expect(left.clanId).toBeNull()

    await expect(ClansService.leave(boss.id)).rejects.toThrow()
    expect(clan.id).toBeTruthy()
  })

  it('sets a one-sided enemy relation immediately, but requires confirmation for alliance', async () => {
    const { boss: bossA } = await clanWithBoss('a')
    const { boss: bossB } = await clanWithBoss('b')
    const clanA = await testPrisma.clanMember.findUniqueOrThrow({ where: { characterId: bossA.id } })
    const clanB = await testPrisma.clanMember.findUniqueOrThrow({ where: { characterId: bossB.id } })

    const hostile = await ClansService.setRelation(bossA.id, clanB.clanId, 'HOSTILITY')
    expect(hostile.confirmed).toBe(true) // вражда объявляется в одностороннем порядке

    const allianceOffer = await ClansService.setRelation(bossB.id, clanA.clanId, 'ALLIANCE')
    expect(allianceOffer.confirmed).toBe(false) // союз ждёт подтверждения второй стороны
  })
})
