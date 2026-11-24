/**
 * Засада — документ Димы v8, раздел 12, одиночная открытая засада.
 *
 * Бинокль покупается в подпольной лавке Чёрного рынка и лежит в «карманах»
 * не активированным. Активировать можно только там, где стоит цель: место
 * игрока — страница, на которой он сейчас. Цели нет на месте — бинокль цел.
 * Бросок нападающего против уворота цели. Успех — цель в критическом (второе
 * за сутки — кома), провал — в критическом сам нападающий. Промежуточных
 * травм нет. На беспомощного (тяжёлая, критическое, кома) не бьют.
 */
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { withTransaction } from '../../shared/db/transaction'
import { ChatRedis } from '../../shared/db/redis'
import { audit } from '../../shared/logger/audit-logger'
import { BalanceConfig } from '../../config/balance.config'
import { EconomyService } from '../economy/economy.service'
import {
  ambushChance, blocksCombat, injuryMinutes, injuryUpdate, knockoutNotice, knockoutTier,
} from './injuries.formulas'

const I = () => BalanceConfig.injuries

const fighterFields = {
  id: true, nickname: true, status: true, location: true, battleLevel: true, pocketBinoculars: true, jailedUntil: true,
  injuryTier: true, injuryUntil: true, injuryTreatedAt: true, injuryCriticalAt: true,
  stats: { select: { agi: true } },
} as const

function refuse(message: string): never {
  throw new AppError(ErrorCode.CONFLICT, message, 409)
}

function hoursText(minutes: number): string {
  const h = minutes / 60
  return Number.isInteger(h) ? (h === 1 ? '1 час' : h < 5 ? `${h} часа` : `${h} часов`) : `${minutes} мин`
}

/** Бригаде пострадавшего — что он в реанимации (раздел 13). */
async function tellBrigade(tx: Parameters<Parameters<typeof withTransaction>[0]>[0], characterId: string, nickname: string, tier: 'CRITICAL' | 'COMA') {
  const member = await tx.clanMember.findUnique({ where: { characterId }, select: { clanId: true, status: true } })
  if (!member || member.status !== 'ACTIVE') return
  const others = await tx.clanMember.findMany({ where: { clanId: member.clanId, status: 'ACTIVE', characterId: { not: characterId } }, select: { characterId: true } })
  const text = `🚨 ${nickname} ${tier === 'COMA' ? 'в коме' : 'в критическом состоянии'}. Реанимация, ${hoursText(injuryMinutes(tier))}. Помочь из общака можно в больнице.`
  if (others.length) await tx.gameNotice.createMany({ data: others.map(o => ({ characterId: o.characterId, text })) })
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
    const success = roll < chance
    const loser = success ? target : attacker
    const tier = knockoutTier(loser, now)

    await withTransaction(async tx => {
      // Бинокль расходуется одним запросом с проверкой: два клика подряд не потратят два.
      const used = await tx.character.updateMany({
        where: { id: attacker.id, pocketBinoculars: { gte: 1 }, status: 'ACTIVE' },
        data: { pocketBinoculars: { decrement: 1 } },
      })
      if (!used.count) refuse('В карманах нет бинокля')
      const fresh = await tx.character.findUniqueOrThrow({ where: { id: loser.id }, select: fighterFields })
      if (fresh.status !== 'ACTIVE' || blocksCombat(fresh, now)) refuse('Цель не найдена в этой локации, предмет не потрачен')
      const data = injuryUpdate(fresh, tier, now)
      if (!data) refuse('Состояние изменилось. Попробуйте ещё раз')
      // Доставка в реанимацию: место персонажа — больница.
      await tx.character.update({ where: { id: loser.id }, data: { ...data, location: '/hospital', lastLocation: '/hospital' } })

      const notices = [
        { characterId: loser.id, text: knockoutNotice(tier) },
        success
          ? { characterId: attacker.id, text: `Засада удалась: ${target.nickname} повержен(а).` }
          : { characterId: attacker.id, text: `❌ Засада провалилась — ${target.nickname} ушёл(ла), вы попали под встречный удар. ${tier === 'COMA' ? 'Кома' : 'Критическое состояние'}, реанимация.` },
        success
          ? { characterId: target.id, text: `⚠️ Вас атаковал ${attacker.nickname}.` }
          : { characterId: target.id, text: `⚠️ ${attacker.nickname} пытался(ась) вас атаковать, но вы ушли. Нападавший в реанимации.` },
      ]
      await tx.gameNotice.createMany({ data: notices })
      await tellBrigade(tx, loser.id, loser.nickname, tier)
    })

    audit('ambush.finished', { attackerId: attacker.id, targetId: target.id, success, chance, tier, location: attacker.location })
    return { success, chance: Math.round(chance * 100), tier, target: target.nickname }
  },
}
