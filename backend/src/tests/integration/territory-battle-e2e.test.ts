/**
 * Война за район от заявки до перехода владения.
 *
 * Тест написан после того, как приёмка Этапа 4 нашла главный дефект этапа:
 * воркер создавал бой строками в базе и не строил живое состояние, поэтому
 * в назначенный бой нельзя было сделать ни одного хода. Участники навсегда
 * оставались IN_BATTLE, заявка навсегда в статусе BATTLE, район не переходил
 * никому — и ни один тест этого не ловил, потому что каждый проверял свой
 * кусок: заявку, воркер, командный бой. Целиком цепочку не проверял никто.
 *
 * Поэтому здесь именно сквозной путь, а не ещё одна проверка звена.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BattleRedis } from '../../shared/db/redis'
import { BattleService } from '../../modules/battles/battles.service'
import { ClansService } from '../../modules/clans/clans.service'
import { ClaimsService } from '../../modules/territories/claims.service'
import { runTerritoryClaims } from '../../workers/territory-claims.worker'
import { AUTHORITY_GAINS } from '../../modules/territories/authority.service'
import { TERRITORIES } from '../../../prisma/economy-data'
import { cleanDatabase, testPrisma, uid } from './helpers'

type LiveState = {
  participants: Array<{
    participantId: string
    characterId: string | null
    side: number
    hpCurrent: number
    isAlive: boolean
    position: { x: number; y: number }
  }>
}

const FULL_BLOCK = ['HEAD', 'CHEST', 'LEFT_ARM', 'RIGHT_ARM'] as const

async function player(prefix: string, hp: number) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({
    data: { login, email: `${login}@test.local`, passwordHash: 'x' },
  })
  const character = await testPrisma.character.create({
    data: {
      userId: user.id, nickname: login, archetype: 'ATHLETE',
      hpCurrent: hp, hpMax: hp, battleLevel: 5, money: 100_000,
    },
  })
  await testPrisma.characterStats.create({
    data: { characterId: character.id, str: 8, agi: 5, rea: 5, acc: 8, end: 5, luck: 5, agr: 5, auth: 5 },
  })
  return { user, character }
}

/** Бригада из пяти бойцов, готовая воевать. */
async function brigade(prefix: string, hp: number) {
  const boss = await player(prefix, hp)
  const clan = await ClansService.create(
    boss.character.id, uid(`${prefix}-clan`), prefix.slice(0, 4).toUpperCase() + uid('x').slice(-2))
  const role = await testPrisma.clanRole.findFirstOrThrow({ where: { clanId: clan.id, code: 'fighter' } })
  const men = [boss]
  for (let i = 1; i < 5; i++) {
    const mate = await player(`${prefix}m${i}`, hp)
    await testPrisma.clanMember.create({
      data: { clanId: clan.id, characterId: mate.character.id, roleId: role.id },
    })
    men.push(mate)
  }
  await testPrisma.clan.update({
    where: { id: clan.id },
    data: { treasury: 100_000, authority: 100 },
  })
  await testPrisma.clanAuthorityLog.create({
    data: { clanId: clan.id, amount: 100, reason: 'ADMIN_ADJUST', balanceAfter: 100 },
  })
  return { boss, clan, men, roster: men.map(m => m.character.id) }
}

async function seedTerritories() {
  for (const { code, name, bonusCode, bonusValue } of TERRITORIES) {
    await testPrisma.territory.create({ data: { code, name, bonusCode, bonusValue } })
  }
}

describe('война за район целиком', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => { await cleanDatabase(); await seedTerritories() })
  afterAll(async () => testPrisma.$disconnect())

  it('от заявки до перехода района: пять на пять, бой играется, владение меняется', async () => {
    // Нападение крепче обороны с огромным запасом: исход обязан быть
    // предсказуем. С сопоставимыми бригадами тест оказывался то зелёным, то
    // красным от разброса урона, а проверяем мы здесь не баланс боя, а то,
    // что цепочка «заявка → бой → владение» доходит до конца.
    const attack = await brigade('war-atk', 400)
    const defence = await brigade('war-def', 1)

    await testPrisma.territory.update({
      where: { code: 'garages' },
      data: {
        ownerClanId: defence.clan.id, status: 'CONTROLLED',
        controlledAt: new Date(), protectedUntil: null,
      },
    })

    const filed = await ClaimsService.file(attack.boss.character.id, 'garages', attack.roster)
    await ClaimsService.setDefence(defence.boss.character.id, filed.claimId, defence.roster)

    // Час боя настал.
    await testPrisma.territoryClaim.update({
      where: { id: filed.claimId },
      data: { battleStartsAt: new Date(Date.now() - 1000) },
    })
    await runTerritoryClaims()

    const claim = await testPrisma.territoryClaim.findUniqueOrThrow({ where: { id: filed.claimId } })
    expect(claim.status).toBe('BATTLE')
    expect(claim.battleId).toBeTruthy()

    // Главное: бой играбелен. Без живого состояния в него нельзя сделать ход.
    const live = await BattleRedis.getState<LiveState>(claim.battleId!)
    expect(live).toBeTruthy()
    expect(live!.participants).toHaveLength(10)
    expect(live!.participants.filter(p => p.side === 1)).toHaveLength(5)
    expect(live!.participants.filter(p => p.side === 2)).toHaveLength(5)

    // Сводим стороны вплотную, иначе раунды уйдут на сближение по сетке.
    for (const part of live!.participants) {
      part.position = part.side === 1 ? { x: 4, y: part.position.y } : { x: 5, y: part.position.y }
    }
    await BattleRedis.setState(claim.battleId!, live)

    // Играем, пока бой не кончится. Потолок раундов — страховка от зависания:
    // тест должен падать по «бой не закончился», а не по таймауту.
    let over = false
    for (let round = 0; round < 30 && !over; round++) {
      const state = await BattleRedis.getState<LiveState>(claim.battleId!)
      if (!state) break
      const aliveIds = new Set(state.participants.filter(p => p.isAlive).map(p => p.characterId))
      // WAR_DEBUG=1 печатает здоровье по раундам. Оставлено намеренно: когда
      // бой не сходится, без этой строки не видно, упирается он в блок или
      // просто не добивает.
      if (process.env.WAR_DEBUG) {
        console.log('round', round, state.participants.map(p => `${p.side}:${p.hpCurrent}${p.isAlive ? '' : 'x'}`).join(' '))
      }
      for (const man of [...attack.men, ...defence.men]) {
        if (!aliveIds.has(man.character.id)) continue
        const attacking = attack.men.includes(man)
        const result = await BattleService.submitAction(man.user.id, claim.battleId!, attacking
          ? { action: 'attack', stance: 'attack2', attackZones: ['CHEST', 'HEAD'], blockZones: [] }
          : { action: 'attack', stance: 'mixed', attackZones: ['CHEST'], blockZones: [...FULL_BLOCK.slice(0, 2)] })
        if ((result as { battleOver?: boolean }).battleOver) { over = true; break }
      }
    }
    expect(over, 'бой не закончился за 30 раундов').toBe(true)

    const battle = await testPrisma.battle.findUniqueOrThrow({ where: { id: claim.battleId! } })
    expect(battle.status).toBe('FINISHED')

    // Оборона легла целиком — иначе воркер посчитает исход обороной, и
    // непонятно будет, дефект это или бой не доиграли.
    const aliveDefence = await testPrisma.battleParticipant.count({
      where: { battleId: battle.id, side: 2, isAlive: true },
    })
    expect(aliveDefence, 'оборона выжила — бой не доигран').toBe(0)

    // Воркер разбирает исход и передаёт владение.
    await runTerritoryClaims()

    const resolved = await testPrisma.territoryClaim.findUniqueOrThrow({ where: { id: filed.claimId } })
    expect(resolved.status).toBe('WON')

    const territory = await testPrisma.territory.findUniqueOrThrow({ where: { code: 'garages' } })
    expect(territory.ownerClanId).toBe(attack.clan.id)
    expect(territory.status).toBe('CONTROLLED')
    expect(territory.protectedUntil).toBeTruthy()

    // Победа даёт авторитет — иначе воевать нечем на второй раз.
    const winner = await testPrisma.clan.findUniqueOrThrow({ where: { id: attack.clan.id } })
    expect(winner.authority).toBeCloseTo(100 - 20 + AUTHORITY_GAINS.territoryWon, 6)

    // Никто не остался запертым в бою.
    const stuck = await testPrisma.character.count({
      where: { id: { in: [...attack.roster, ...defence.roster] }, status: 'IN_BATTLE' },
    })
    expect(stuck).toBe(0)
  }, 60_000)

  it('опыт оружия начисляется всем участникам войны, а не только дуэлянтам', async () => {
    const attack = await brigade('wsk-atk', 400)
    const defence = await brigade('wsk-def', 1)
    await testPrisma.territory.update({
      where: { code: 'center' },
      data: { ownerClanId: defence.clan.id, status: 'CONTROLLED', controlledAt: new Date(), protectedUntil: null },
    })

    const filed = await ClaimsService.file(attack.boss.character.id, 'center', attack.roster)
    await ClaimsService.setDefence(defence.boss.character.id, filed.claimId, defence.roster)
    await testPrisma.territoryClaim.update({
      where: { id: filed.claimId },
      data: { battleStartsAt: new Date(Date.now() - 1000) },
    })
    await runTerritoryClaims()
    const claim = await testPrisma.territoryClaim.findUniqueOrThrow({ where: { id: filed.claimId } })

    const live = await BattleRedis.getState<LiveState>(claim.battleId!)
    for (const part of live!.participants) {
      part.position = part.side === 1 ? { x: 4, y: part.position.y } : { x: 5, y: part.position.y }
    }
    await BattleRedis.setState(claim.battleId!, live)

    let over = false
    for (let round = 0; round < 30 && !over; round++) {
      const state = await BattleRedis.getState<LiveState>(claim.battleId!)
      if (!state) break
      const aliveIds = new Set(state.participants.filter(p => p.isAlive).map(p => p.characterId))
      for (const man of [...attack.men, ...defence.men]) {
        if (!aliveIds.has(man.character.id)) continue
        const attacking = attack.men.includes(man)
        const result = await BattleService.submitAction(man.user.id, claim.battleId!, attacking
          ? { action: 'attack', stance: 'attack2', attackZones: ['CHEST', 'HEAD'], blockZones: [] }
          : { action: 'attack', stance: 'mixed', attackZones: ['CHEST'], blockZones: [...FULL_BLOCK.slice(0, 2)] })
        if ((result as { battleOver?: boolean }).battleOver) { over = true; break }
      }
    }
    expect(over).toBe(true)

    // До 03.09.2026 командный бой не начислял опыт оружия вовсе: войны за
    // район не двигали навык ни одному участнику.
    const skills = await testPrisma.weaponSkill.findMany({
      where: { characterId: { in: attack.roster }, skillExp: { gt: 0 } },
    })
    expect(skills.length).toBeGreaterThan(0)
  }, 60_000)
})
