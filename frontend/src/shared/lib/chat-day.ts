// Эфир сбрасывается в 00:00 МСК, а не в полночь часового пояса браузера.
// Те же границы использует API; записи в БД остаются для модерации.
export const CHAT_DAY_MS = 86_400_000
const MOSCOW_OFFSET_MS = 3 * 3_600_000

export function chatDayStart(now = Date.now()): number {
  return Math.floor((now + MOSCOW_OFFSET_MS) / CHAT_DAY_MS) * CHAT_DAY_MS - MOSCOW_OFFSET_MS
}

/** Фильтруем и кэш, и запоздавшие ответы API/сокета после полуночи. */
export function todayChatLines<T extends { createdAt: string }>(lines: T[], dayStart: number): T[] {
  return lines.filter(line => Date.parse(line.createdAt) >= dayStart)
}

/** Один таймер на ближайшую полночь; refresh догоняет пропущенные сутки. */
export function startChatDayClock(onDay: (dayStart: number) => void): { refresh: () => void; stop: () => void } {
  let timer: ReturnType<typeof setTimeout>
  let stopped = false
  const refresh = () => {
    if (stopped) return
    clearTimeout(timer)
    const now = Date.now()
    const start = chatDayStart(now)
    onDay(start)
    timer = setTimeout(refresh, Math.max(1, start + CHAT_DAY_MS - now))
  }
  refresh()
  return {
    refresh,
    stop: () => { stopped = true; clearTimeout(timer) },
  }
}
