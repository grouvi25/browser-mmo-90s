// =============================================================
// ЗАЯВКИ НА ТЕРРИТОРИЮ — фоновая часть
//
// Раз в минуту: назначить бой тем заявкам, чей час настал, и разобрать
// исход тем, чей бой закончился. Идемпотентен и переживает падение между
// тиками — состояние живёт в статусе заявки, а не в памяти процесса.
//
// ТЗ: docs/specs/stage-4/MASTER_TZ_STAGE_4_STRATEGY_PREMIUM_WAR.md, раздел 22.
// =============================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '../shared/db/prisma'
import { withTransaction } from '../shared/db/transaction'
import { AuthorityService, AUTHORITY_GAINS } from '../modules/territories/authority.service'
import { releaseTerritory } from '../modules/territories/claims.service'
import { TERRITORY_PROTECTION_HOURS } from '../modules/territories/territories.formulas'
import { syncTiers } from './clan-maintenance.worker'

export const TERRITORY_CLAIMS_MS = 60 * 1000

const HOUR_MS = 3_600_000

/** Назначить бои и разобрать исходы. Возвращает, сколько заявок тронуто. */
export async function runTerritoryClaims(now = new Date()): Promise<number> {
  return (await startDueBattles(now)) + (await resolveFinishedBattles(now))
}

/**
 * Час настал — создаём бой из состава заявки.
 *
 * Состав переносится дословно, сторона в сторону: то, что обороняющийся
 * видел с момента подачи, и есть то, с чем он будет драться.
 */
async function startDueBattles(now: Date): Promise<number> {
  const due = await prisma.territoryClaim.findMany({
    where: { status: 'PENDING', battleStartsAt: { lte: now } },
    include: { roster: true, territory: true },
    take: 50,
  })
  let started = 0

  for (const claim of due) {
    const attackers = claim.roster.filter(row => row.side === 1)
    const defenders = claim.roster.filter(row => row.side === 2)

    // Оборона никого не выставила — техническая победа. Но район всё равно
    // уходит под защиту на те же 48 часов: безответная война не должна быть
    // быстрее честной.
    if (defenders.length === 0) {
      await withTransaction(async tx => {
        await tx.territoryClaim.update({
          where: { id: claim.id },
          data: { status: 'WON', walkover: true, resolvedAt: now },
        })
        await transferControl(tx, claim.territoryId, claim.attackerClanId, now)
        await AuthorityService.grant(tx, {
          clanId: claim.attackerClanId, amount: AUTHORITY_GAINS.territoryWon,
          reason: 'TERRITORY_WON', refId: claim.id,
        })
      })
      started += 1
      continue
    }

    await withTransaction(async tx => {
      const battle = await tx.battle.create({
        data: {
          type: 'TERRITORY',
          status: 'ACTIVE',
          levelMin: 1,
          levelMax: 99,
          roundCount: Math.max(attackers.length, defenders.length),
          startedAt: now,
        },
      })
      const rows = [...attackers, ...defenders]
      const characters = await tx.character.findMany({
        where: { id: { in: rows.map(row => row.characterId) } },
        select: { id: true, hpCurrent: true, hpMax: true },
      })
      const byId = new Map(characters.map(character => [character.id, character]))
      for (const row of rows) {
        const character = byId.get(row.characterId)
        if (!character) continue
        await tx.battleParticipant.create({
          data: {
            battleId: battle.id, characterId: row.characterId, side: row.side,
            hpMax: character.hpMax, hpCurrent: character.hpCurrent,
          },
        })
      }
      await tx.character.updateMany({
        where: { id: { in: rows.map(row => row.characterId) }, status: 'ACTIVE' },
        data: { status: 'IN_BATTLE' },
      })
      await tx.territoryClaim.update({
        where: { id: claim.id },
        data: { status: 'BATTLE', battleId: battle.id },
      })
      await tx.territory.update({ where: { id: claim.territoryId }, data: { status: 'UNDER_ATTACK' } })
    })
    started += 1
  }
  return started
}

/** Бой закончился — передать контроль или оставить обороне. */
async function resolveFinishedBattles(now: Date): Promise<number> {
  const running = await prisma.territoryClaim.findMany({
    where: { status: 'BATTLE', battleId: { not: null } },
    include: { battle: { include: { participants: true } } },
    take: 50,
  })
  let resolved = 0

  for (const claim of running) {
    const battle = claim.battle
    if (!battle) continue
    if (battle.status !== 'FINISHED' && battle.status !== 'TECHNICAL_WIN' && battle.status !== 'CANCELLED') continue

    // Победитель по стороне: чья сторона осталась в живых. Отдельного поля
    // «сторона-победитель» у боя нет, и заводить его ради войны незачем —
    // живые участники говорят то же самое.
    const aliveAttack = battle.participants.filter(p => p.side === 1 && p.isAlive && !p.isSurrendered).length
    const aliveDefence = battle.participants.filter(p => p.side === 2 && p.isAlive && !p.isSurrendered).length
    const attackerWon = aliveAttack > 0 && aliveDefence === 0

    await withTransaction(async tx => {
      if (attackerWon) {
        await tx.territoryClaim.update({
          where: { id: claim.id },
          data: { status: 'WON', resolvedAt: now },
        })
        await transferControl(tx, claim.territoryId, claim.attackerClanId, now)
        await AuthorityService.grant(tx, {
          clanId: claim.attackerClanId, amount: AUTHORITY_GAINS.territoryWon,
          reason: 'TERRITORY_WON', refId: claim.id,
        })
      } else {
        await tx.territoryClaim.update({
          where: { id: claim.id },
          data: { status: 'LOST', resolvedAt: now },
        })
        await releaseTerritory(tx, claim.territoryId)
        // Оборона дороже атаки: обороняющийся не выбирал время боя.
        if (claim.defenderClanId) {
          await AuthorityService.grant(tx, {
            clanId: claim.defenderClanId, amount: AUTHORITY_GAINS.territoryDefended,
            reason: 'TERRITORY_DEFENDED', refId: claim.id,
          })
        }
      }
    })
    resolved += 1
  }
  return resolved
}

/**
 * Передать район новому владельцу.
 *
 * Долг прежнего владельца списывается вместе с районом: платить за чужой
 * долг новый хозяин не должен, а старый уже наказан потерей.
 */
async function transferControl(
  tx: Prisma.TransactionClient,
  territoryId: string,
  clanId: string,
  now: Date,
) {
  const before = await tx.territory.findUniqueOrThrow({
    where: { id: territoryId },
    select: { ownerClanId: true },
  })
  await tx.territory.update({
    where: { id: territoryId },
    data: {
      ownerClanId: clanId,
      status: 'CONTROLLED',
      controlledAt: now,
      protectedUntil: new Date(now.getTime() + TERRITORY_PROTECTION_HOURS * HOUR_MS),
      upkeepDebt: 0,
      lastChargedAt: now,
    },
  })
  await syncTiers(clanId)
  if (before.ownerClanId && before.ownerClanId !== clanId) await syncTiers(before.ownerClanId)
}
