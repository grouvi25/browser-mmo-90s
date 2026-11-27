/**
 * Итог засады для проигравшего: критическое (второе за сутки — кома),
 * доставка в реанимацию, весть бригаде. Нужен и засаде, и концу дуэли,
 * которой засада стала 26.11 (обращение №196), поэтому живёт отдельно —
 * иначе сервис засады и боевой сервис импортировали бы друг друга.
 */
import type { Prisma } from '@prisma/client'
import { injuryMinutes, injuryUpdate, knockoutNotice, knockoutTier } from './injuries.formulas'

type Tx = Prisma.TransactionClient

const injuryFields = {
  id: true, nickname: true,
  injuryTier: true, injuryUntil: true, injuryTreatedAt: true, injuryCriticalAt: true,
} as const

function hoursText(minutes: number): string {
  const h = minutes / 60
  return Number.isInteger(h) ? (h === 1 ? '1 час' : h < 5 ? `${h} часа` : `${h} часов`) : `${minutes} мин`
}

/** Бригаде пострадавшего — что он в реанимации (раздел 13). */
export async function tellBrigade(tx: Tx, characterId: string, nickname: string, tier: 'CRITICAL' | 'COMA') {
  const member = await tx.clanMember.findUnique({ where: { characterId }, select: { clanId: true, status: true } })
  if (!member || member.status !== 'ACTIVE') return
  const others = await tx.clanMember.findMany({ where: { clanId: member.clanId, status: 'ACTIVE', characterId: { not: characterId } }, select: { characterId: true } })
  const text = `🚨 ${nickname} ${tier === 'COMA' ? 'в коме' : 'в критическом состоянии'}. Реанимация, ${hoursText(injuryMinutes(tier))}. Помочь из общака можно в больнице.`
  if (others.length) await tx.gameNotice.createMany({ data: others.map(o => ({ characterId: o.characterId, text })) })
}

/**
 * Проигравший засаду — в реанимацию. Возвращает ступень или null, если
 * персонаж уже лежит с тем же или более тяжёлым состоянием.
 */
export async function knockOut(tx: Tx, characterId: string, now = new Date()): Promise<'CRITICAL' | 'COMA' | null> {
  const fresh = await tx.character.findUniqueOrThrow({ where: { id: characterId }, select: injuryFields })
  const tier = knockoutTier(fresh, now)
  const data = injuryUpdate(fresh, tier, now)
  if (!data) return null
  // Доставка в реанимацию: место персонажа — больница.
  await tx.character.update({ where: { id: characterId }, data: { ...data, location: '/hospital', lastLocation: '/hospital' } })
  await tx.gameNotice.create({ data: { characterId, text: knockoutNotice(tier) } })
  await tellBrigade(tx, characterId, fresh.nickname, tier)
  return tier
}
