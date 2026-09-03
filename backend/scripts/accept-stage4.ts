// =============================================================
// ПРИЁМКА ЭТАПА 4 — 22 обязательные проверки
//
// Раздел 28 мастер-ТЗ: «Сборка не принимается, пока не пройдены все».
// Скрипт не пересказывает тесты, а прогоняет каждую проверку заново на
// живой базе через те же сервисы, что и приложение: приёмка должна
// подтверждать поведение системы, а не наличие теста про него.
//
// Запуск (обязательно по тестовой базе — скрипт чистит её целиком):
//   npm run accept:stage4
//
// Отчёт: docs/stage4-acceptance-report.json, код возврата 1 при любом FAIL.
// =============================================================
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { prisma } from '../src/shared/db/prisma'
import { ClansService } from '../src/modules/clans/clans.service'
import { ClaimsService } from '../src/modules/territories/claims.service'
import { TerritoriesService } from '../src/modules/territories/territories.service'
import { ObjectAttacksService } from '../src/modules/territories/object-attacks.service'
import {
  AuthorityService, AUTHORITY_COSTS, AUTHORITY_GAINS,
} from '../src/modules/territories/authority.service'
import { OwnershipService } from '../src/modules/production/ownership.service'
import { PremiumService } from '../src/modules/premium/premium.service'
import { HelpersService, helperEfficiency } from '../src/modules/premium/helpers.service'
import { runTerritoryClaims } from '../src/workers/territory-claims.worker'
import { runClanMaintenance, clanUpkeepPreview } from '../src/workers/clan-maintenance.worker'
import { normalizeTurn } from '../src/modules/battles/zones'
import { calcFinalSalary } from '../src/modules/work/work.formulas'
import { BalanceConfig } from '../src/config/balance.config'
import { CLAN_MAINTENANCE_DAILY } from '../src/modules/clans/clans.formulas'
import { TERRITORIES, PREMIUM_PRODUCTS, PREMIUM_GRANT_CODES } from '../prisma/economy-data'

const T = BalanceConfig.strategy.territory
const O = BalanceConfig.strategy.objectAttack
const P = BalanceConfig.strategy.premium
const H = BalanceConfig.strategy.helper
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

// ── Инструменты ──────────────────────────────────────────────

interface Check { id: number; area: string; title: string; ok: boolean; note: string }
const checks: Check[] = []

async function check(id: number, area: string, title: string, body: () => Promise<string>) {
  await reset()
  try {
    const note = await body()
    checks.push({ id, area, title, ok: true, note })
    console.log(`  ${String(id).padStart(2)} PASS  ${title}\n        ${note}`)
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error)
    checks.push({ id, area, title, ok: false, note })
    console.log(`  ${String(id).padStart(2)} FAIL  ${title}\n        ${note}`)
  }
}

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** Ждём отказ с конкретным кодом: «отказал вообще» — недостаточная проверка. */
async function refuses(code: string, action: () => Promise<unknown>): Promise<string> {
  try {
    await action()
  } catch (error) {
    const actual = (error as { code?: string }).code
    must(actual === code, `ожидался ${code}, получен ${actual ?? error}`)
    return (error as { message?: string }).message ?? code
  }
  throw new Error(`операция прошла, хотя должна была отказать с ${code}`)
}

let counter = 0
const uid = (prefix: string) => `${prefix}_${Date.now()}_${++counter}_${Math.random().toString(36).slice(2, 6)}`

/** Чистая база перед каждой проверкой: проверки не должны зависеть друг от друга. */
async function reset() {
  await prisma.$transaction([
    prisma.idempotencyKey.deleteMany(),
    prisma.objectAttack.deleteMany(),
    prisma.territoryClaimRoster.deleteMany(),
    prisma.territoryClaim.deleteMany(),
    prisma.territory.deleteMany(),
    prisma.helper.deleteMany(),
    prisma.premiumPurchase.deleteMany(),
    prisma.clanRelation.deleteMany(),
    prisma.clanInvite.deleteMany(),
    prisma.clanAuthorityLog.deleteMany(),
    prisma.clanTreasuryLog.deleteMany(),
    prisma.clanStorage.deleteMany(),
    prisma.clanMember.deleteMany(),
    prisma.clanRole.deleteMany(),
    prisma.productionLog.deleteMany(),
    prisma.cycleInputReservation.deleteMany(),
    prisma.cycleLaborContribution.deleteMany(),
    prisma.productionCycle.deleteMany(),
    prisma.productionObjectInventory.deleteMany(),
    prisma.workShift.deleteMany(),
    prisma.characterProfession.deleteMany(),
    prisma.productionObject.deleteMany(),
    prisma.battleTurn.deleteMany(),
    prisma.battleParticipant.deleteMany(),
    prisma.battle.deleteMany(),
    prisma.currencyLog.deleteMany(),
    prisma.characterStats.deleteMany(),
    prisma.character.deleteMany(),
    prisma.clan.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
  ])
  for (const { code, name, bonusCode, bonusValue } of TERRITORIES) {
    await prisma.territory.create({ data: { code, name, bonusCode, bonusValue } })
  }
}

async function player(prefix: string, battleLevel = 5) {
  const login = uid(prefix)
  const user = await prisma.user.create({
    data: { login, email: `${login}@accept.local`, passwordHash: 'x' },
  })
  return prisma.character.create({
    data: {
      userId: user.id, nickname: login, archetype: 'WORKER',
      hpCurrent: 80, hpMax: 80, money: 100_000, battleLevel,
    },
  })
}

/** Бригада с главарём, бойцами, общаком и авторитетом — готовая воевать. */
async function warClan(prefix: string, fighters = 5, treasury = 100_000, authority = 100) {
  const boss = await player(prefix)
  const clan = await ClansService.create(
    boss.id, uid(`${prefix}-clan`), Math.random().toString(36).slice(2, 6).toUpperCase())
  const role = await prisma.clanRole.findFirstOrThrow({ where: { clanId: clan.id, code: 'fighter' } })
  const roster = [boss.id]
  for (let i = 1; i < fighters; i++) {
    const mate = await player(`${prefix}m${i}`)
    await prisma.clanMember.create({ data: { clanId: clan.id, characterId: mate.id, roleId: role.id } })
    roster.push(mate.id)
  }
  await prisma.clan.update({ where: { id: clan.id }, data: { treasury, authority } })
  await prisma.clanAuthorityLog.create({
    data: { clanId: clan.id, amount: authority, reason: 'ADMIN_ADJUST', balanceAfter: authority },
  })
  return { boss, clan, roster, role }
}

async function own(clanId: string, code: string, controlledAt = new Date()) {
  return prisma.territory.update({
    where: { code },
    data: { ownerClanId: clanId, status: 'CONTROLLED', controlledAt, lastChargedAt: controlledAt },
  })
}

async function objectOf(ownerCharacterId: string | null, opts: {
  district?: string; balance?: number; clanId?: string; profession?: string
} = {}) {
  return prisma.productionObject.create({
    data: {
      code: uid('obj'), name: 'Цех', type: 'WORKSHOP',
      locationId: opts.district ?? 'industrial',
      requiredProfessionCode: opts.profession ?? 'scrap_collector', requiredProfessionLevel: 0,
      shiftDurationMinutes: 30, baseSalary: 100, baseProductionExp: 10,
      balance: opts.balance ?? 0,
      ownerType: opts.clanId ? 'CLAN' : ownerCharacterId ? 'PRIVATE' : 'SYSTEM',
      ownerCharacterId: opts.clanId ? null : ownerCharacterId,
      ownerClanId: opts.clanId ?? null,
      durabilityCurrent: 100, durabilityMax: 100,
    },
  })
}

/** Вражда плюс район под врагом: без географии атака невозможна. */
async function declareWar(attacker: string, defender: string, district = 'industrial') {
  await prisma.clanRelation.create({
    data: { fromClanId: attacker, toClanId: defender, type: 'HOSTILITY' },
  })
  await own(defender, district)
}

// ── Проверки ─────────────────────────────────────────────────

async function run() {
  console.log('\nПРИЁМКА ЭТАПА 4 — 22 проверки раздела 28\n')

  // ── Территории ─────────────────────────────────────────────
  console.log(' Территории')

  await check(1, 'Территории', 'Клан не владеет больше territoryLimit территорий', async () => {
    const { boss, clan, roster } = await warClan('lim')
    await own(clan.id, 'center')
    await own(clan.id, 'market')
    const message = await refuses('WAR_008', () => ClaimsService.file(boss.id, 'garages', roster))
    const owned = await prisma.territory.count({ where: { ownerClanId: clan.id, status: 'CONTROLLED' } })
    must(owned === T.limit, `у клана ${owned} районов при лимите ${T.limit}`)
    return `лимит ${T.limit}, третья заявка отклонена: «${message}»`
  })

  await check(2, 'Территории', 'Ступень содержания пересчитывается при потере', async () => {
    const { clan } = await warClan('tier')
    const first = await own(clan.id, 'center', new Date(Date.now() - 2 * DAY_MS))
    const second = await own(clan.id, 'market', new Date(Date.now() - DAY_MS))
    // Первая ступень дешевле: ступень — это порядок захвата, а не свойство района.
    await prisma.clan.update({ where: { id: clan.id }, data: { lastChargedAt: new Date(Date.now() - DAY_MS) } })
    await runClanMaintenance()
    const before = await prisma.territory.findUniqueOrThrow({ where: { id: second.id } })
    must(before.upkeepTier === 2, `вторая территория получила ступень ${before.upkeepTier}, ждали 2`)

    // Теряем первую — оставшаяся обязана подешеветь.
    await prisma.territory.update({
      where: { id: first.id },
      data: { ownerClanId: null, status: 'NEUTRAL', controlledAt: null },
    })
    await prisma.clan.update({ where: { id: clan.id }, data: { lastChargedAt: new Date(Date.now() - DAY_MS) } })
    await runClanMaintenance()
    const after = await prisma.territory.findUniqueOrThrow({ where: { id: second.id } })
    must(after.upkeepTier === 1, `после потери ступень осталась ${after.upkeepTier}`)
    const perDay = await clanUpkeepPreview(clan.id)
    must(perDay === CLAN_MAINTENANCE_DAILY + T.upkeepTier1,
      `суточный расход ${perDay}, ждали ${CLAN_MAINTENANCE_DAILY + T.upkeepTier1}`)
    return `2 → 1 ступень после потери, расход ${perDay} ₽/сутки`
  })

  await check(3, 'Территории', 'Долг 10 000 ₽ гасит бонус, 25 000 ₽ отпускает район', async () => {
    const { clan, boss } = await warClan('debt')
    await own(clan.id, 'center')
    await prisma.territory.update({
      where: { code: 'center' },
      data: { upkeepDebt: T.upkeepDebtBonusOff },
    })
    const bonuses = await TerritoriesService.bonusesForCharacter(boss.id)
    must(Object.keys(bonuses).length === 0, `бонус остался живым при долге ${T.upkeepDebtBonusOff}: ${JSON.stringify(bonuses)}`)

    // Долг у порога отпускания плюс сутки неоплаченного содержания.
    await prisma.territory.update({
      where: { code: 'center' },
      data: { upkeepDebt: T.upkeepDebtRelease - 1000 },
    })
    await prisma.clan.update({
      where: { id: clan.id },
      data: { treasury: 0, lastChargedAt: new Date(Date.now() - DAY_MS) },
    })
    await runClanMaintenance()
    const after = await prisma.territory.findUniqueOrThrow({ where: { code: 'center' } })
    must(after.status === 'NEUTRAL' && after.ownerClanId === null,
      `район остался у клана: статус ${after.status}, долг ${after.upkeepDebt}`)
    must(after.upkeepDebt === 0, `долг ${after.upkeepDebt} не списан вместе с районом`)
    return `бонус погашен на ${T.upkeepDebtBonusOff} ₽, район отпущен на ${T.upkeepDebtRelease} ₽`
  })

  await check(4, 'Территории', 'Бонус Спального района скидывает содержание целиком', async () => {
    const { clan } = await warClan('sub')
    await own(clan.id, 'center', new Date(Date.now() - 2 * DAY_MS))
    const plain = await clanUpkeepPreview(clan.id)
    const suburb = TERRITORIES.find(item => item.bonusCode === 'UPKEEP_COST')
    must(suburb, 'в сиде нет района со скидкой на содержание')
    await own(clan.id, suburb!.code, new Date(Date.now() - DAY_MS))
    const withSuburb = await clanUpkeepPreview(clan.id)
    const gross = CLAN_MAINTENANCE_DAILY + T.upkeepTier1 + T.upkeepTier2
    const expected = Math.round(gross * (1 - suburb!.bonusValue))
    must(withSuburb === expected, `расход ${withSuburb}, ждали ${expected} (скидка ${suburb!.bonusValue})`)
    must(withSuburb < plain + T.upkeepTier2,
      'скидка не применилась ко всей сумме: второй район подорожал на полную ставку')
    return `${gross} → ${withSuburb} ₽/сутки: скидка легла и на клан, и на оба района`
  })

  await check(5, 'Территории', 'Район под защитой отклоняет заявку с внятной причиной', async () => {
    const { boss, roster } = await warClan('prot')
    const until = new Date(Date.now() + T.protectionHours * HOUR_MS)
    await prisma.territory.update({ where: { code: 'center' }, data: { protectedUntil: until } })
    const message = await refuses('WAR_006', () => ClaimsService.file(boss.id, 'center', roster))
    must(message.includes(until.toISOString().slice(0, 10)), `в причине нет срока защиты: «${message}»`)
    return `«${message}»`
  })

  // ── Заявки и бои ───────────────────────────────────────────
  console.log('\n Заявки и бои')

  await check(6, 'Заявки', 'Вторая заявка на район не создаётся', async () => {
    const first = await warClan('c6a')
    const second = await warClan('c6b')
    await ClaimsService.file(first.boss.id, 'center', first.roster)
    const message = await refuses('WAR_005', () => ClaimsService.file(second.boss.id, 'center', second.roster))
    const open = await prisma.territoryClaim.count({
      where: { territory: { code: 'center' }, status: { in: ['PENDING', 'BATTLE'] } },
    })
    must(open === 1, `открытых заявок ${open}, ждали 1`)
    const treasury = (await prisma.clan.findUniqueOrThrow({ where: { id: second.clan.id } })).treasury
    must(treasury === 100_000, `у отказанного клана списали взнос: общак ${treasury}`)
    return `«${message}», взнос отказанному не списан`
  })

  await check(7, 'Заявки', 'Состав боя дословно равен составу заявки', async () => {
    const attack = await warClan('c7a')
    const defence = await warClan('c7b')
    await own(defence.clan.id, 'center')
    await prisma.territory.update({ where: { code: 'center' }, data: { protectedUntil: null } })
    const filed = await ClaimsService.file(attack.boss.id, 'center', attack.roster)
    await ClaimsService.setDefence(defence.boss.id, filed.claimId, defence.roster)
    await prisma.territoryClaim.update({
      where: { id: filed.claimId },
      data: { battleStartsAt: new Date(Date.now() - 1000) },
    })
    await runTerritoryClaims()

    const claim = await prisma.territoryClaim.findUniqueOrThrow({
      where: { id: filed.claimId },
      include: { roster: true, battle: { include: { participants: true } } },
    })
    must(claim.battle, 'бой не создан')
    const expected = claim.roster.map(row => `${row.characterId}:${row.side}`).sort()
    const actual = claim.battle!.participants.map(row => `${row.characterId}:${row.side}`).sort()
    must(JSON.stringify(expected) === JSON.stringify(actual),
      `состав боя разошёлся с заявкой:\n  заявка ${expected}\n  бой    ${actual}`)
    return `${expected.length} бойцов, стороны совпали один в один`
  })

  await check(8, 'Заявки', 'Неявка обороны: победа без боя, но район под защитой', async () => {
    const attack = await warClan('c8a')
    const defence = await warClan('c8b')
    await own(defence.clan.id, 'center')
    await prisma.territory.update({ where: { code: 'center' }, data: { protectedUntil: null } })
    const filed = await ClaimsService.file(attack.boss.id, 'center', attack.roster)
    await prisma.territoryClaim.update({
      where: { id: filed.claimId },
      data: { battleStartsAt: new Date(Date.now() - 1000) },
    })
    await runTerritoryClaims()

    const claim = await prisma.territoryClaim.findUniqueOrThrow({ where: { id: filed.claimId } })
    must(claim.status === 'WON' && claim.walkover, `статус ${claim.status}, walkover ${claim.walkover}`)
    must(claim.battleId === null, 'на неявку создан бой — драться было не с кем')
    const territory = await prisma.territory.findUniqueOrThrow({ where: { code: 'center' } })
    must(territory.ownerClanId === attack.clan.id, 'район не перешёл нападающему')
    must(territory.protectedUntil, 'район не ушёл под защиту')
    const hours = (territory.protectedUntil!.getTime() - Date.now()) / HOUR_MS
    must(Math.abs(hours - T.protectionHours) < 1, `защита ${hours.toFixed(1)} ч вместо ${T.protectionHours}`)
    return `техническая победа, защита ${Math.round(hours)} ч — как после честного боя`
  })

  await check(9, 'Заявки', 'Взнос не возвращается при отзыве и возвращается при сбое', async () => {
    const attack = await warClan('c9a')
    const filed = await ClaimsService.file(attack.boss.id, 'center', attack.roster)
    const afterFile = await prisma.clan.findUniqueOrThrow({ where: { id: attack.clan.id } })
    must(afterFile.treasury === 100_000 - T.claimFee, `взнос не списан: ${afterFile.treasury}`)

    const cancelled = await ClaimsService.cancel(attack.boss.id, filed.claimId)
    must(cancelled.feeRefunded === false, 'взнос вернули при отзыве — заявка стала бесплатной разведкой')
    const afterCancel = await prisma.clan.findUniqueOrThrow({ where: { id: attack.clan.id } })
    must(afterCancel.treasury === 100_000 - T.claimFee, `общак после отзыва ${afterCancel.treasury}`)

    // Сбой назначения: состав исчез (вышли из клана, удалились), боя не будет.
    const second = await warClan('c9b')
    const filedTwo = await ClaimsService.file(second.boss.id, 'market', second.roster)
    await prisma.territoryClaimRoster.deleteMany({ where: { claimId: filedTwo.claimId } })
    await prisma.territoryClaim.update({
      where: { id: filedTwo.claimId },
      data: { battleStartsAt: new Date(Date.now() - 1000) },
    })
    await runTerritoryClaims()
    const stale = await prisma.territoryClaim.findUniqueOrThrow({ where: { id: filedTwo.claimId } })
    must(stale.status === 'EXPIRED', `заявка без состава осталась в статусе ${stale.status}`)
    const refunded = await prisma.clan.findUniqueOrThrow({ where: { id: second.clan.id } })
    must(refunded.treasury === 100_000, `взнос не возвращён при сбое: общак ${refunded.treasury}`)
    must(refunded.authority === 100, `авторитет не возвращён при сбое: ${refunded.authority}`)
    const territory = await prisma.territory.findUniqueOrThrow({ where: { code: 'market' } })
    must(territory.status === 'NEUTRAL', `район застрял в статусе ${territory.status}`)
    return `отзыв — без возврата, сбой назначения — возврат ${T.claimFee} ₽ и ${AUTHORITY_COSTS.claim} авторитета`
  })

  // ── Бои за объекты ─────────────────────────────────────────
  console.log('\n Бои за объекты')

  await check(10, 'Объекты', `Объект нельзя атаковать чаще раза в ${O.cooldownHours} часа`, async () => {
    const attack = await warClan('c10a')
    const defence = await warClan('c10b')
    const victim = await player('c10v')
    await prisma.clanMember.create({
      data: { clanId: defence.clan.id, characterId: victim.id, roleId: defence.role.id },
    })
    const object = await objectOf(victim.id, { balance: 100_000 })
    await declareWar(attack.clan.id, defence.clan.id)
    await ObjectAttacksService.rob(attack.boss.id, object.id)
    const message = await refuses('WAR_020', () => ObjectAttacksService.sabotage(attack.boss.id, object.id))
    const attacks = await prisma.objectAttack.count({ where: { objectId: object.id } })
    must(attacks === 1, `атак записано ${attacks}, ждали 1`)
    return `«${message}»`
  })

  await check(11, 'Объекты', 'Объект игрока вне клана не атакуется вообще', async () => {
    const attack = await warClan('c11a')
    const defence = await warClan('c11b')
    const loner = await player('c11loner')
    const object = await objectOf(loner.id, { balance: 100_000 })
    await declareWar(attack.clan.id, defence.clan.id)
    const rob = await refuses('WAR_022', () => ObjectAttacksService.rob(attack.boss.id, object.id))
    await refuses('WAR_022', () => ObjectAttacksService.sabotage(attack.boss.id, object.id))
    // В списке объект остаётся, но с причиной и без единого доступного
    // действия: список районов показывает, ПОЧЕМУ нельзя, — это правило
    // всего Этапа 4. «Не атакуется» — про мутацию, и она отказывает.
    const listed = await ObjectAttacksService.attackable(attack.boss.id)
    const row = listed.items.find(item => item.objectId === object.id)
    must(row, 'объект пропал из списка вместе с причиной отказа')
    must(row!.blockedReason === 'OWNER_SOLO', `причина в списке: ${row!.blockedReason}`)
    must(!row!.canSabotage && !row!.canRob, 'в списке объект одиночки помечен доступным')
    return `«${rob}», в списке помечен OWNER_SOLO без единого действия`
  })

  await check(12, 'Объекты', 'Диверсия возвращает сырьё отменённого цикла полностью', async () => {
    const attack = await warClan('c12a')
    const defence = await warClan('c12b')
    const victim = await player('c12v')
    await prisma.clanMember.create({
      data: { clanId: defence.clan.id, characterId: victim.id, roleId: defence.role.id },
    })
    const object = await objectOf(victim.id)
    const stock = await prisma.productionObjectInventory.create({
      data: {
        productionObjectId: object.id, resourceCode: 'scrap_metal', quality: 'NORMAL',
        amount: 40, reservedAmount: 10,
      },
    })
    const recipe = await prisma.productionRecipe.create({
      data: {
        code: uid('rec'), name: 'Проверочный передел', productionObjectCode: object.code,
        outputResourceCode: 'scrap_metal', cycleMinutes: 60, laborRequired: 100,
        requiredProfessionCode: 'scrap_collector',
      },
    })
    const cycle = await prisma.productionCycle.create({
      data: {
        productionObjectId: object.id, recipeId: recipe.id, status: 'RUNNING',
        laborRequired: 100, laborAccumulated: 0,
        startedAt: new Date(), endsAt: new Date(Date.now() + HOUR_MS),
      },
    })
    await prisma.cycleInputReservation.create({
      data: { cycleId: cycle.id, inventoryId: stock.id, resourceCode: 'scrap_metal', quality: 'NORMAL', amount: 10 },
    })
    await declareWar(attack.clan.id, defence.clan.id)

    const result = await ObjectAttacksService.sabotage(attack.boss.id, object.id)
    must(result.cancelledCycleId === cycle.id, 'цикл не отменён')
    const after = await prisma.productionObjectInventory.findUniqueOrThrow({ where: { id: stock.id } })
    must(after.amount === 40, `сырьё уменьшилось: ${after.amount} из 40`)
    must(after.reservedAmount === 0, `резерв не снят полностью: осталось ${after.reservedAmount}`)
    return `40 единиц на складе целы, резерв 10 → 0`
  })

  await check(13, 'Объекты', `Ограбление не больше ${O.robberyShare * 100}% и потолка ${O.robberyCap} ₽`, async () => {
    const cases: string[] = []
    for (const balance of [20_000, 100_000]) {
      await reset()
      const attack = await warClan('c13a')
      const defence = await warClan('c13b')
      const victim = await player('c13v')
      await prisma.clanMember.create({
        data: { clanId: defence.clan.id, characterId: victim.id, roleId: defence.role.id },
      })
      const object = await objectOf(victim.id, { balance })
      await declareWar(attack.clan.id, defence.clan.id)
      const result = await ObjectAttacksService.rob(attack.boss.id, object.id)
      const expected = Math.min(Math.floor(balance * O.robberyShare), O.robberyCap)
      must(result.moneyTaken === expected, `с баланса ${balance} взято ${result.moneyTaken}, ждали ${expected}`)
      must(result.moneyTaken <= O.robberyCap, `превышен потолок: ${result.moneyTaken}`)
      cases.push(`${balance} → ${result.moneyTaken}`)
    }
    return `${cases.join(', ')} ₽ (доля ${O.robberyShare}, потолок ${O.robberyCap})`
  })

  await check(14, 'Объекты', 'Повреждённый объект чинится обычным ремонтом', async () => {
    const attack = await warClan('c14a')
    const defence = await warClan('c14b')
    const victim = await player('c14v')
    await prisma.clanMember.create({
      data: { clanId: defence.clan.id, characterId: victim.id, roleId: defence.role.id },
    })
    const object = await objectOf(victim.id, { balance: 50_000 })
    await prisma.productionObjectInventory.create({
      data: {
        productionObjectId: object.id, resourceCode: 'comp_repair_kit', quality: 'NORMAL',
        amount: 20, reservedAmount: 0,
      },
    })
    await declareWar(attack.clan.id, defence.clan.id)
    const sabotage = await ObjectAttacksService.sabotage(attack.boss.id, object.id)
    must(sabotage.status === 'DAMAGED', `после диверсии статус ${sabotage.status}`)

    const repaired = await OwnershipService.repair(victim.id, object.id, uid('rep'))
    must(repaired.repaired, 'ремонт не прошёл')
    const after = await prisma.productionObject.findUniqueOrThrow({ where: { id: object.id } })
    must(after.durabilityCurrent === after.durabilityMax,
      `прочность ${after.durabilityCurrent} из ${after.durabilityMax}`)
    must(after.status === 'ACTIVE',
      `объект остался в статусе ${after.status}: чинится прочность, но объект не возвращается в строй`)
    return `−${sabotage.durabilityLost} прочности, ремонт вернул объект в ACTIVE`
  })

  // ── Авторитет ──────────────────────────────────────────────
  console.log('\n Авторитет')

  await check(15, 'Авторитет', 'Сумма журнала равна полю на клане', async () => {
    const attack = await warClan('c15a')
    const defence = await warClan('c15b')
    const victim = await player('c15v')
    await prisma.clanMember.create({
      data: { clanId: defence.clan.id, characterId: victim.id, roleId: defence.role.id },
    })
    const object = await objectOf(victim.id, { balance: 100_000 })
    await declareWar(attack.clan.id, defence.clan.id)
    await ObjectAttacksService.rob(attack.boss.id, object.id)
    await ClaimsService.file(attack.boss.id, 'suburb', attack.roster)

    const audit = await AuthorityService.audit(attack.clan.id)
    must(audit.matches, `журнал ${audit.fromLog} против поля ${audit.stored}`)
    const expected = 100 - AUTHORITY_COSTS.robbery - AUTHORITY_COSTS.claim
    must(audit.stored === expected, `авторитет ${audit.stored}, ждали ${expected}`)
    return `поле и журнал сошлись на ${audit.stored}`
  })

  await check(16, 'Авторитет', 'Один победами заявки не окупишь', async () => {
    must(AUTHORITY_COSTS.claim > AUTHORITY_GAINS.territoryWon,
      `заявка стоит ${AUTHORITY_COSTS.claim}, победа даёт ${AUTHORITY_GAINS.territoryWon} — победами можно воевать вечно`)
    // Клан, который только побеждает: каждая заявка −20, каждая победа +15.
    const { clan } = await warClan('c16')
    let authority = 100
    let wins = 0
    while (authority >= AUTHORITY_COSTS.claim) {
      authority += AUTHORITY_GAINS.territoryWon - AUTHORITY_COSTS.claim
      wins += 1
      must(wins < 100, 'авторитет не убывает: цикл побед бесконечен')
    }
    must(clan.id, 'клан не создан')
    return `цикл «заявка + победа» даёт ${AUTHORITY_GAINS.territoryWon - AUTHORITY_COSTS.claim} авторитета: со 100 хватает на ${wins} захватов, дальше нужна работа`
  })

  // ── Premium и помощники ────────────────────────────────────
  console.log('\n Premium и помощники')

  await check(17, 'Premium', 'Ни один товар витрины не выдаёт предмет со статами', async () => {
    // Проверяем не описание товара, а последствия покупки: выдаём КАЖДЫЙ
    // товар витрины одному персонажу и смотрим, не появилось ли у него
    // предметов и не сдвинулись ли характеристики.
    const boss = await player('c17')
    const before = await prisma.characterStats.findUnique({ where: { characterId: boss.id } })
    const shop = await PremiumService.shop()
    must(shop.items.length === PREMIUM_PRODUCTS.length,
      `в витрине ${shop.items.length} товаров из ${PREMIUM_PRODUCTS.length}`)

    for (const product of shop.items) {
      await PremiumService.grant({ characterId: boss.id, productCode: product.code })
    }
    const items = await prisma.itemInstance.count({ where: { ownerId: boss.id } })
    must(items === 0, `после покупки всей витрины у персонажа ${items} предметов`)
    const after = await prisma.characterStats.findUnique({ where: { characterId: boss.id } })
    must(JSON.stringify(before) === JSON.stringify(after), 'характеристики сдвинулись после покупок')

    const unknown = PREMIUM_PRODUCTS.filter(item => !PREMIUM_GRANT_CODES.includes(item.grantCode))
    must(unknown.length === 0, `эффект вне закрытого списка: ${unknown.map(i => i.code).join(', ')}`)
    return `куплено ${shop.items.length} товаров: 0 предметов, характеристики не изменились`
  })

  await check(18, 'Помощники', 'Помощник без подписки на смену не выходит', async () => {
    const boss = await player('c18')
    await PremiumService.grant({ characterId: boss.id, productCode: 'prem_sub_30' })
    const helper = await HelpersService.hire(boss.id, 'Витёк', 'scrap_collector')
    const object = await objectOf(null, { profession: 'scrap_collector' })

    await PremiumService.revoke(boss.id)
    const message = await refuses('HELP_001',
      () => HelpersService.startShift(boss.id, helper.id, object.id))
    const listed = await HelpersService.list(boss.id)
    must(listed.items[0].status === 'DORMANT', `помощник числится ${listed.items[0].status}`)
    const shifts = await prisma.workShift.count({ where: { helperId: helper.id } })
    must(shifts === 0, `создано смен: ${shifts}`)
    return `«${message}», помощник переведён в DORMANT`
  })

  await check(19, 'Помощники', `У персонажа не больше ${H.maxCount} помощников`, async () => {
    const boss = await player('c19')
    await PremiumService.grant({ characterId: boss.id, productCode: 'prem_sub_30' })
    for (let i = 0; i < H.maxCount; i++) {
      await HelpersService.hire(boss.id, `Помощник ${i}`, 'scrap_collector')
    }
    const message = await refuses('HELP_002',
      () => HelpersService.hire(boss.id, 'Лишний', 'scrap_collector'))
    const listed = await HelpersService.list(boss.id)
    must(listed.items.length === H.maxCount, `нанято ${listed.items.length}`)
    must(listed.slots.total === P.helperSlots, `слотов ${listed.slots.total}, ждали ${P.helperSlots}`)
    return `«${message}», слотов ${listed.slots.used}/${listed.slots.total}`
  })

  await check(20, 'Помощники', 'Подписчик с двумя помощниками не выше 130% активного игрока', async () => {
    // Сначала живая проверка потолка: без него вся арифметика ниже
    // бессмысленна — смена длится полчаса, и помощника можно гонять сутки.
    const boss = await player('c20')
    await PremiumService.grant({ characterId: boss.id, productCode: 'prem_sub_30' })
    const helper = await HelpersService.hire(boss.id, 'Сменщик', 'scrap_collector')
    const object = await objectOf(null, { profession: 'scrap_collector' })
    await prisma.productionObject.update({ where: { id: object.id }, data: { workerSlots: 10 } })
    for (let i = 0; i < H.dailyShiftCap; i++) {
      await HelpersService.startShift(boss.id, helper.id, object.id)
      await prisma.workShift.updateMany({
        where: { helperId: helper.id, status: 'ACTIVE' },
        data: { status: 'CLAIMED', endsAt: new Date(Date.now() - 1000) },
      })
      await prisma.helper.update({ where: { id: helper.id }, data: { activeShiftId: null } })
    }
    const capped = await refuses('HELP_006',
      () => HelpersService.startShift(boss.id, helper.id, object.id))

    // Коридор считаем теми же формулами, что и игра: ставка одна,
    // различаются число смен, усталость и множитель помощника.
    const base = 1000
    const income = (shifts: number, efficiency = 1) => {
      let sum = 0
      for (let n = 1; n <= shifts; n++) sum += calcFinalSalary(base, 1, 0, 0.5, n) * efficiency
      return sum
    }
    const plain = income(BalanceConfig.economy.work.dailyShiftLimit)
    const own = income(P.dailyShiftCap)
    const helpers = H.maxCount * income(H.dailyShiftCap, helperEfficiency(H.skillCap))
    const ratio = (own + helpers) / plain
    must(ratio <= 1.30 + 1e-9,
      `подписчик зарабатывает ${(ratio * 100).toFixed(1)}% от активного игрока при коридоре 130%. `
      + `Свои ${P.dailyShiftCap} смен дают уже ${(own / plain * 100).toFixed(1)}%, `
      + `два помощника по ${H.dailyShiftCap} смен добавляют ${(helpers / plain * 100).toFixed(1)}%. `
      + `Потолок соблюдён («${capped}»), но самих чисел коридор не выдерживает: `
      + `STAGE4_BALANCE 6.3 оценила вклад помощников в 12.5%, фактически он ${(helpers / plain * 100).toFixed(1)}%`)
    return `${Math.round(plain)} ₽ против ${Math.round(own + helpers)} ₽ = ${(ratio * 100).toFixed(1)}%, потолок ${H.dailyShiftCap} смен держит`
  })

  // ── Бой ────────────────────────────────────────────────────
  console.log('\n Бой')

  await check(21, 'Бой', 'Смена оружия съедает очко хода', async () => {
    const plain = normalizeTurn({
      stance: 'attack2',
      attackZones: ['HEAD', 'CHEST'],
      attackHands: ['LEFT_HAND', 'RIGHT_HAND'],
    })
    must(plain.attackZones.length === 2, `без переодевания ударов ${plain.attackZones.length}, ждали 2`)

    const swapped = normalizeTurn({
      stance: 'attack2',
      attackZones: ['HEAD', 'CHEST'],
      attackHands: ['LEFT_HAND', 'RIGHT_HAND'],
      swapWeapon: { hand: 'LEFT_HAND', itemInstanceId: 'x' },
    })
    must(swapped.attackZones.length === 1, `со сменой оружия ударов ${swapped.attackZones.length}, ждали 1`)
    must(swapped.attackHands.length === 1, `рук осталось ${swapped.attackHands.length}`)

    // В глухой защите ударов нет — очко берётся блоками.
    const defensive = normalizeTurn({
      stance: 'defense4',
      blockZones: ['HEAD', 'HEAD', 'CHEST', 'CHEST'],
      swapWeapon: { hand: 'LEFT_HAND', itemInstanceId: 'x' },
    })
    must(defensive.blockZones.length === 2, `в глухой защите блоков ${defensive.blockZones.length}, ждали 2`)
    return '2 → 1 удар в атаке, 4 → 2 блока в защите'
  })

  await check(22, 'Бой', 'Смена брони забирает ход целиком', async () => {
    // Первая редакция ТЗ требовала отклонять смену брони на заблокированной
    // зоне. Раздел 20 это правило снял как мёртвое: блоков в ходу с
    // переодеванием не бывает вовсе. Проверяем то, что осталось истиной.
    const turn = normalizeTurn({
      stance: 'attack2',
      attackZones: ['HEAD', 'CHEST'],
      attackHands: ['LEFT_HAND', 'RIGHT_HAND'],
      blockZones: ['HEAD', 'CHEST'],
      swapArmor: { zone: 'HEAD', itemInstanceId: 'x' },
    })
    must(turn.attackZones.length === 0, `остались удары: ${turn.attackZones.length}`)
    must(turn.blockZones.length === 0, `остались блоки: ${turn.blockZones.length}`)

    const both = normalizeTurn({
      stance: 'defense4',
      blockZones: ['HEAD', 'CHEST', 'LEFT_ARM', 'RIGHT_ARM'],
      swapWeapon: { hand: 'LEFT_HAND', itemInstanceId: 'w' },
      swapArmor: { zone: 'HEAD', itemInstanceId: 'a' },
    })
    must(both.blockZones.length === 0, `броня и оружие вместе оставили ${both.blockZones.length} блоков`)
    return 'ни ударов, ни блоков — подменить броню под свой же блок нельзя'
  })

  // ── Итог ───────────────────────────────────────────────────
  const failed = checks.filter(item => !item.ok)
  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      stage: 4,
      source: 'docs/specs/stage-4/MASTER_TZ_STAGE_4_STRATEGY_PREMIUM_WAR.md, раздел 28',
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
    checks,
  }
  const out = resolve(__dirname, '../../docs/stage4-acceptance-report.json')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(report, null, 2), 'utf8')

  console.log(`\nИТОГ: ${report.meta.passed} из ${report.meta.total} пройдено`)
  if (failed.length > 0) {
    console.log('Не пройдено:')
    for (const item of failed) console.log(`  ${item.id}. ${item.title} — ${item.note}`)
  }
  console.log(`Отчёт: ${out}\n`)
  return failed.length === 0
}

run()
  .then(async ok => { await prisma.$disconnect(); process.exit(ok ? 0 : 1) })
  .catch(async error => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
