// =============================================================
// Открытая вкладка живёт на той сборке, с которой её открыли: игрок сутками
// видел старые ошибки, которые уже исправлены (обращения 6 и 21).
//
// Раз в пять минут и при возврате на вкладку сверяем файл сборки с сервером.
// Вышла новая: перезагружаем страницу на следующем переходе, поэтому посреди
// ввода ничего не теряется. В бою не трогаем, бой доигрывается на своей сборке.
// =============================================================
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

const CHECK_EVERY_MS = 5 * 60_000
const ENTRY = /\/assets\/index-[\w-]+\.js/

/** Файл сборки из текста страницы или null, если его там нет. */
export function entryOf(html: string): string | null {
  return ENTRY.exec(html)?.[0] ?? null
}

export function UpdateWatcher() {
  const { pathname } = useLocation()
  const stale = useRef(false)
  const opened = useRef(pathname)

  useEffect(() => {
    // На локальном стенде vite отдаёт файлы без хеша: сверять нечего.
    const running = [...document.scripts].map(script => entryOf(script.src)).find(Boolean)
    if (!running) return
    const check = async () => {
      if (stale.current || document.hidden) return
      try {
        const res = await fetch('/', { cache: 'no-store' })
        if (!res.ok) return
        const latest = entryOf(await res.text())
        if (latest && latest !== running) stale.current = true
      } catch { /* нет сети: проверим в следующий раз */ }
    }
    const timer = setInterval(() => { void check() }, CHECK_EVERY_MS)
    const onVisible = () => { void check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  useEffect(() => {
    if (pathname === opened.current) return
    opened.current = pathname
    if (stale.current && !pathname.startsWith('/battle/')) window.location.reload()
  }, [pathname])

  return null
}
