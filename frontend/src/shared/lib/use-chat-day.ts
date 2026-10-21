import { useEffect, useState } from 'react'
import { chatDayStart, startChatDayClock } from './chat-day'

/** Сбрасывает открытую ленту без ожидания следующего запроса/реплики. */
export function useChatDay(): number {
  const [dayStart, setDayStart] = useState(() => chatDayStart())

  useEffect(() => {
    const clock = startChatDayClock(setDayStart)
    // Таймеры в спящей вкладке могут задерживаться на часы. Пересчитываем
    // границу сразу по возвращении, включая восстановление из bfcache.
    window.addEventListener('focus', clock.refresh)
    window.addEventListener('pageshow', clock.refresh)
    document.addEventListener('visibilitychange', clock.refresh)
    return () => {
      clock.stop()
      window.removeEventListener('focus', clock.refresh)
      window.removeEventListener('pageshow', clock.refresh)
      document.removeEventListener('visibilitychange', clock.refresh)
    }
  }, [])

  return dayStart
}
