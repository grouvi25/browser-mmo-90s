// =============================================================
// Развёрнут ли чат района.
//
// Состояние живёт снаружи самого чата, потому что от него зависит
// высота сцены: развёрнутый чат — это полная композиция макета
// (1550x900), свёрнутый — только игровая часть (1550x705), и в окно
// она вписывается крупнее. То есть чат не налезает на интерфейс, а
// делится с ним местом.
// =============================================================
import { useCallback, useEffect, useState } from 'react'

const KEY = 'mmo_chat_open'

export function useChatOpen(): [boolean, () => void] {
  // По умолчанию развёрнут: чат района — часть экрана по макету, а не
  // всплывающая панель. Выбор игрока запоминается.
  const [open, setOpen] = useState(true)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY)
      if (saved !== null) setOpen(saved === '1')
    } catch {
      // приватный режим — остаёмся на значении по умолчанию
    }
  }, [])

  const toggle = useCallback(() => {
    setOpen(prev => {
      const next = !prev
      try { localStorage.setItem(KEY, next ? '1' : '0') } catch { /* см. выше */ }
      return next
    })
  }, [])

  return [open, toggle]
}
