/**
 * HP Recovery Worker — Этап 1.5
 *
 * Каждые 10 секунд восстанавливает HP персонажам не в бою.
 *
 * Промежуточная формула: 100% HP за 1 минуту.
 * Финальная (задел): Standard=20мин, Premium=10мин, +клановая лечебница -50%
 *
 * tickPerSecond = hpMax / recoverySeconds
 * Запускается каждые TICK_MS и добавляет tickPerSecond * (TICK_MS/1000)
 */

import { prisma } from '../shared/db/prisma'
import { logger } from '../shared/logger/logger'

export const TICK_MS = 10_000 // каждые 10 секунд
const RECOVERY_SECONDS_DEFAULT = 60 // 100% HP за 1 минуту (промежуток)

function getRecoverySeconds(isPremium: boolean): number {
  // Будущая формула:
  // isPremium ? 10 * 60 : 20 * 60
  return RECOVERY_SECONDS_DEFAULT
}

export async function runHpRecovery(): Promise<void> {
  // Находим всех персонажей не в бою с неполным HP через raw сравнение
  const characters = await prisma.$queryRaw<Array<{id: string; hp_current: number; hp_max: number; is_premium: boolean}>>`
    SELECT id, hp_current, hp_max, is_premium
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
