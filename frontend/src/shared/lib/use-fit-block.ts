// =============================================================
// Ужимает блок текста в ширину, заданную макетом.
//
// Подменные шрифты шире оригинальных (B52 / Stengazeta), из-за
// чего чат переносился на лишние строки, а ники налезали на
// уровни. Вместо уменьшения кегля сжимаем блок по горизонтали:
// высота строк и вес букв сохраняются, ширина совпадает с PSD.
// =============================================================
import { useEffect, type RefObject } from 'react'

export function useFitBlock(
  ref: RefObject<HTMLElement | null>,
  targetWidth: number,
  deps: unknown[] = [],
): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    let cancelled = false
    const apply = () => {
      if (cancelled || !el) return
      el.style.transform = 'none'
      const natural = el.offsetWidth
      if (natural > 0) {
        const k = Math.min(1, targetWidth / natural)
        el.style.transform = `scaleX(${k})`
      }
    }

    apply()
    if (document.fonts?.ready) void document.fonts.ready.then(apply)
    window.addEventListener('resize', apply)
    return () => {
      cancelled = true
      window.removeEventListener('resize', apply)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, targetWidth, ...deps])
}
