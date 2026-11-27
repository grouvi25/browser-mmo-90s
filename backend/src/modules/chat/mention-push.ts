/**
 * Пуш при обращении в общем чате (обращение №191, решение Миши 26.11):
 * «Ник, …» в общем эфире — пуш на телефон этому игроку, но только если он
 * не в сети. Кто в игре, и так видит подсвеченную строку в ленте.
 *
 * Обращение — ник в начале строки, за ним запятая. Можно окликнуть
 * нескольких сразу: «Ник1, Ник2, идём на стрелку».
 */
import { prisma } from '../../shared/db/prisma'
import { hasListeners } from '../../shared/realtime/io'
import { pushLater } from '../push/push.service'
import { addressedNicknames, privateRoom } from './chat.formulas'

export async function pushGlobalMentions(line: { authorId?: string | null; nickname: string; body: string }): Promise<string[]> {
  const nicks = addressedNicknames(line.body)
  if (!nicks.length) return []
  const found = await prisma.character.findMany({
    where: { nickname: { in: nicks, mode: 'insensitive' }, ...(line.authorId ? { id: { not: line.authorId } } : {}) },
    select: { id: true, nickname: true },
  })
  const pushed: string[] = []
  for (const target of found) {
    // Нашлось не то: Prisma сравнивает без регистра, а нам нужен целый ник.
    if (!nicks.includes(target.nickname.toLocaleLowerCase('ru'))) continue
    if (await hasListeners(privateRoom(target.id))) continue
    pushLater(target.id, { title: `${line.nickname} в общем чате`, body: line.body, url: '/', kind: 'private' })
    pushed.push(target.id)
  }
  return pushed
}
