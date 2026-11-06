/**
 * Пуши в приложение-оболочку (заказчик 06.11): личные сообщения и системные
 * события — смена закончилась, цех закончил цикл, ответила поддержка.
 *
 * Отправка не мешает игре: вызывается после сохранения и не ждёт Firebase,
 * любая ошибка только пишется в лог. Телефон, который больше не принимает
 * пуши (удалили приложение), забывается сам.
 */
import { prisma } from '../../shared/db/prisma'
import { logger } from '../../shared/logger/logger'
import { fcmEnabled, sendFcm, type SendResult } from './fcm'

export type PushKind = 'private' | 'work' | 'production' | 'support'
export type Push = { title: string; body: string; url: string; kind: PushKind }

type Sender = (token: string, push: Push) => Promise<SendResult>
let sender: Sender | null = null

const MAX_BODY = 160
const short = (text: string) => (text.length > MAX_BODY ? `${text.slice(0, MAX_BODY - 1)}…` : text)

export const PushService = {
  /** Телефон прислал токен: привязать к игроку. Тот же телефон под другим аккаунтом переходит к нему. */
  async register(userId: string, token: string, platform = 'android') {
    await prisma.pushDevice.upsert({
      where: { token },
      update: { userId, platform, lastSeenAt: new Date() },
      create: { userId, token, platform },
    })
  },

  /** Выход из игры на телефоне: пуши этому аккаунту на него больше не идут. */
  async unregister(userId: string, token: string) {
    await prisma.pushDevice.deleteMany({ where: { token, userId } })
  },

  enabled: () => !!sender || fcmEnabled(),

  /** Отправить игроку на все его телефоны. Не ждать: вызывать через void. */
  async toCharacter(characterId: string, push: Push): Promise<number> {
    if (!PushService.enabled()) return 0
    try {
      const character = await prisma.character.findUnique({ where: { id: characterId }, select: { userId: true } })
      if (!character) return 0
      const devices = await prisma.pushDevice.findMany({ where: { userId: character.userId }, select: { id: true, token: true } })
      let sent = 0
      for (const device of devices) {
        const result = await (sender ?? sendFcm)(device.token, { ...push, body: short(push.body) })
        if (result === 'sent') sent += 1
        if (result === 'gone') await prisma.pushDevice.delete({ where: { id: device.id } }).catch(() => undefined)
      }
      return sent
    } catch (error) {
      logger.warn({ error, characterId, kind: push.kind }, '[Push] не отправлен')
      return 0
    }
  },

  /** Для тестов: подменить отправку. null — вернуть настоящую. */
  setSenderForTests(next: Sender | null) { sender = next },
}

/** Отправить и забыть: игра не ждёт Firebase и не падает от него. */
export function pushLater(characterId: string, push: Push): void {
  void PushService.toCharacter(characterId, push)
}
