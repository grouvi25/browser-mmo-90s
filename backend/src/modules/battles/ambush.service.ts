/**
 * Засада — документ Димы v8, раздел 12, одиночная открытая засада.
 *
 * Бинокль покупается в подпольной лавке Чёрного рынка и лежит в «карманах»
 * не активированным. Активировать можно только там, где стоит цель: место
 * игрока — страница, на которой он сейчас. Цели нет на месте — бинокль цел.
 * На беспомощного (тяжёлая, критическое, кома) не бьют.
 *
 * Решение 26.11 (Миша, обращение №196): засада — обычная дуэль по ходам, как
 * на Стрелках. Цель сразу попадает в бой; не у экрана — за неё ходит общий
 * таймер (60 с, на втором пропуске замерзает). Бросок засады остаётся как
 * «внезапность»: успех — нападающий бьёт первый раунд, цель не отвечает;
 * провал — бой на равных. Проигравший — в критическое (второе за сутки —
 * кома), победитель без травм. Один на один, без помощников и собак,
 * расходники можно. Опыт как за дуэль, денег нет.
 */
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { withTransaction } from '../../shared/db/transaction'
import { ChatRedis } from '../../shared/db/redis'
import { audit } from '../../shared/logger/audit-logger'
import { BalanceConfig } from '../../config/balance.config'
import { EconomyService } from '../economy/economy.service'
import { ambushChance, blocksCombat, combatReady } from './injuries.formulas'
import { BattleService } from './battles.service'

const I = () => BalanceConfig.injuries

const fighterFields = {
  id: true, nickname: true, status: true, location: true, battleLevel: true, pocketBinoculars: true, jailedUntil: true,
  hpCurrent: true, hpMax: true,
  injuryTier: true, injuryUntil: true, injuryTreatedAt: true, injuryCriticalAt: true,
  stats: { select: { agi: true } },
} as const

function refuse(message: string): never {
  throw new AppError(ErrorCode.CONFLICT, message, 409)
}

export const AmbushService = {
  async pockets(userId: string) {
    const me = await prisma.character.findUnique({ where: { userId }, select: { pocketBinoculars: true, money: true } })
    if (!me) throw AppError.notFound('Character', userId)
    return { binoculars: me.pocketBinoculars, max: I().binocularsMax, price: I().binocularsRub }
  },

  /** Подпольная лавка: бинокль в карманы. */
  async buyBinoculars(userId: string) {
    return withTransaction(async tx => {
      const me = await tx.character.findUnique({ where: { userId }, select: { id: true } })
      if (!me) throw AppError.notFound('Character', userId)
      const put = await tx.character.updateMany({
        where: { id: me.id, pocketBinoculars: { lt: I().binocularsMax } },
        data: { pocketBinoculars: { increment: 1 } },
      })
      if (!put.count) refuse('Бинокль уже лежит в карманах')
      await EconomyService.debit(tx, { characterId: me.id, amount: I().binocularsRub, reasonCode: 'UNDERGROUND_SHOP', note: 'Бинокль' })
      const after = await tx.character.findUniqueOrThrow({ where: { id: me.id }, select: { pocketBinoculars: true } })
      return { binoculars: after.pocketBinoculars }
    })
  },

  async ambush(userId: string, targetId: string, now = new Date(), roll = Math.random()) {
    const attacker = await prisma.character.findUnique({ where: { userId }, select: fighterFields })
    if (!attacker) throw AppError.notFound('Character', userId)
    const target = await prisma.character.findUnique({ where: { id: targetId }, select: fighterFields })
    if (!target) throw AppError.notFound('Character', targetId)
    if (target.id === attacker.id) refuse('Себя в засаду не возьмёшь')
    if (attacker.pocketBinoculars < 1) refuse('В карманах нет бинокля. Он продаётся в подпольной лавке Чёрного рынка')
    if (attacker.status !== 'ACTIVE') refuse('Сейчас вы заняты: закончите бой или смену')
    if (blocksCombat(attacker, now)) refuse('С такой травмой в засаду не ходят')
    if (attacker.battleLevel < I().ambushMinLevel) refuse(`Засады — с ${I().ambushMinLevel} боевого уровня`)
    if (target.battleLevel < I().ambushMinLevel) refuse('Новичков не трогают')
    if (blocksCombat(target, now)) refuse('На беспомощного не бьют')
    const seen = await ChatRedis.presenceAt(target.id)
    const here = !!attacker.location && attacker.location === target.location
      && target.status === 'ACTIVE' && seen !== null && now.getTime() - seen <= I().ambushOnlineMinutes * 60_000
    if (!here) refuse('Цель не найдена в этой локации, предмет не потрачен')

    const chance = ambushChance(attacker.stats?.agi ?? 0, target.stats?.agi ?? 0, attacker, target, now)
    const surprise = roll < chance

    const battleId = await withTransaction(async tx => {
      // Бинокль расходуется одним запросом с проверкой: два клика подряд не потратят два.
      const used = await tx.character.updateMany({
        where: { id: attacker.id, pocketBinoculars: { gte: 1 }, status: 'ACTIVE' },
        data: { pocketBinoculars: { decrement: 1 } },
      })
      if (!used.count) refuse('В карманах нет бинокля')
      // Обоих в бой одним махом: цель могла за это время уйти на смену или в другой бой.
      const claimedAttacker = await tx.character.updateMany({
        where: { id: attacker.id, status: 'ACTIVE', ...combatReady(now) },
        data: { status: 'IN_BATTLE' },
      })
      if (!claimedAttacker.count) refuse('Сейчас вы заняты: закончите бой или смену')
      const claimedTarget = await tx.character.updateMany({
        where: { id: target.id, status: 'ACTIVE', ...combatReady(now) },
        data: { status: 'IN_BATTLE' },
      })
      if (!claimedTarget.count) refuse('Цель не найдена в этой локации, предмет не потрачен')

      const battle = await tx.battle.create({
        data: { type: 'PVP_DUEL', status: 'WAITING_PLAYERS', levelMin: 1, levelMax: 99, creatorId: attacker.id },
      })
      await tx.battleParticipant.createMany({ data: [
        { battleId: battle.id, characterId: attacker.id, side: 1, hpMax: attacker.hpMax, hpCurrent: attacker.hpCurrent },
        { battleId: battle.id, characterId: target.id, side: 2, hpMax: target.hpMax, hpCurrent: target.hpCurrent },
      ] })
      await tx.gameNotice.createMany({ data: [
        {
          characterId: target.id,
          text: surprise
            ? `⚠️ На вас напал из засады ${attacker.nickname}! Вы застигнуты врасплох: первый удар за ним. Бой уже идёт.`
            : `⚠️ ${attacker.nickname} пытался(ась) напасть из засады, но вы заметили его(её) вовремя. Бой на равных уже идёт.`,
        },
      ] })
      return battle.id
    })

    try {
      await BattleService.beginDuelState(battleId, { ambush: { attackerId: attacker.id, targetId: target.id, surprise } })
    } catch (error) {
      // Бой не открылся: отпускаем обоих и возвращаем бинокль, иначе они
      // висели бы «в бою» без боя до минутной уборки.
      await withTransaction(async tx => {
        await tx.battle.update({ where: { id: battleId }, data: { status: 'CANCELLED', finishedAt: new Date() } })
        await tx.character.updateMany({ where: { id: { in: [attacker.id, target.id] }, status: 'IN_BATTLE' }, data: { status: 'ACTIVE' } })
        await tx.character.update({ where: { id: attacker.id }, data: { pocketBinoculars: { increment: 1 } } })
      })
      throw error
    }

    audit('ambush.started', { attackerId: attacker.id, targetId: target.id, battleId, surprise, chance, location: attacker.location })
    return { battleId, surprise, chance: Math.round(chance * 100), target: target.nickname }
  },
}
