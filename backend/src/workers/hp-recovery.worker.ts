/**
 * HP Recovery Worker — Этап 1.5
 *
 * Каждые 10 секунд восстанавливает HP персонажам не в бою.
 *
 * Правило заказчика (28.10): с нуля до полного — 10 минут с премиум-
 * подпиской и 30 минут без неё, пропорционально: половина здоровья
 * восстанавливается за 5 и 15 минут. Премиум — пока не истёк его срок.
 *
 * tickPerSecond = hpMax / recoverySeconds
 * Запускается каждые TICK_MS и добавляет tickPerSecond * (TICK_MS/1000)
 */

import { prisma } from '../shared/db/prisma'

export const TICK_MS = 10_000 // каждые 10 секунд
export const RECOVERY_SECONDS_PREMIUM = 10 * 60
export const RECOVERY_SECONDS_STANDARD = 30 * 60

export function getRecoverySeconds(isPremium: boolean): number {
  return isPremium ? RECOVERY_SECONDS_PREMIUM : RECOVERY_SECONDS_STANDARD
}

export async function runHpRecovery(): Promise<void> {
  // Находим всех персонажей не в бою с неполным HP через raw сравнение
  const characters = await prisma.$queryRaw<Array<{id: string; hp_current: number; hp_max: number; is_premium: boolean}>>`
    SELECT id, hp_current, hp_max,
      (is_premium AND (premium_expires_at IS NULL OR premium_expires_at > now())) AS is_premium
    FROM characters
    WHERE status != 'IN_BATTLE' AND hp_current < hp_max
    LIMIT 500
  `

  if (characters.length === 0) return

  const tickSec = TICK_MS / 1000

  for (const char of characters) {
    const recoverySec = getRecoverySeconds(char.is_premium)
    const tickHp = Math.ceil((char.hp_max / recoverySec) * tickSec)
    const newHp = Math.min(char.hp_max, char.hp_current + tickHp)
    if (newHp !== char.hp_current) {
      await prisma.character.update({
        where: { id: char.id },
        data: { hpCurrent: newHp },
      })
    }
  }
}
