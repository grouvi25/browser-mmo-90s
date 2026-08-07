// =============================================================
// Слежение за медиазапросом из React. Нужен, чтобы городская
// оболочка выбирала композицию: фиксированную сцену по макету
// на большом экране или потоковую вёрстку на телефоне.
// =============================================================
import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** Порог мобильной композиции.
 *  Сцена макета — 1550×900. Ниже 900 CSS-пикселей ширины она ужимается
 *  так, что подписи меню становятся мельче 12 px, то есть нечитаемыми;
 *  с этой точки переходим на потоковую вёрстку. */
export const MOBILE_QUERY = '(max-width: 900px)'

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY)
}
