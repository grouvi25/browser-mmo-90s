// =============================================================
// Сцена — фиксированная композиция по PSD-макету.
//
// Макеты нарисованы на холсте A4 @300dpi, поэтому под экран они
// не подходят напрямую. Рабочая система координат = макет / 2:
//   главный экран  3509x2481 -> 1754x1240
//   профиль        2481x3509 -> 1240x1754
// Ассеты остаются в исходном разрешении, то есть автоматически @2x.
//
// Вся вёрстка внутри сцены абсолютная, в координатах макета.
// Сцена целиком масштабируется под окно, по бокам остаётся поле.
// =============================================================
import {
  createContext, useContext, useEffect, useLayoutEffect,
  useRef, useState, type CSSProperties, type ReactNode,
} from 'react'

export interface StageBox { x: number; y: number; w: number; h: number }

interface StageContextValue { scale: number }
const StageContext = createContext<StageContextValue>({ scale: 1 })

/** Текущий масштаб сцены — нужен тем, кто считает координаты мыши. */
export function useStageScale(): number {
  return useContext(StageContext).scale
}

export type StageFit = 'contain' | 'width'

/**
 * Масштаб сцены под текущее окно.
 *
 * Вынесен отдельным хуком, чтобы один экран мог считать масштаб
 * другого: у профиля холст вертикальный (A4), у главного экрана —
 * горизонтальный, и без привязки одни и те же элементы выходили бы
 * разного размера на разных экранах.
 */
export function useViewportScale(
  width: number, height: number, fit: StageFit = 'contain', maxScale = 1.5,
): number {
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    function recalc() {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const k = fit === 'width' ? vw / width : Math.min(vw / width, vh / height)
      setScale(Math.min(k, maxScale))
    }
    recalc()
    window.addEventListener('resize', recalc)
    return () => window.removeEventListener('resize', recalc)
  }, [width, height, fit, maxScale])

  return scale
}

interface StageProps {
  width: number
  height: number
  /** contain — вписать целиком (главный экран), width — по ширине со скроллом */
  fit?: StageFit
  maxScale?: number
  /** Готовый масштаб: сцена не считает его сама (нужно для привязки экранов) */
  scale?: number
  className?: string
  children: ReactNode
}

/**
 * Оболочка сцены. Держит реальную высоту после масштабирования,
 * чтобы страница скроллилась корректно.
 */
export function Stage({
  width, height, fit = 'contain', maxScale = 1.5,
  scale: scaleOverride, className = '', children,
}: StageProps) {
  const auto = useViewportScale(width, height, fit, maxScale)
  const scale = scaleOverride ?? auto
  const holderRef = useRef<HTMLDivElement>(null)

  const holderStyle: CSSProperties = { height: height * scale }
  // Сцена прижата к left:50%, поэтому сдвигаем её на половину УЖЕ
  // отмасштабированной ширины — иначе центровка уезжает при k != 1.
  const stageStyle: CSSProperties = {
    width, height,
    transform: `translateX(${-(width * scale) / 2}px) scale(${scale})`,
  }

  return (
    <StageContext.Provider value={{ scale }}>
      <div className="stage-holder" ref={holderRef} style={holderStyle}>
        <div className={`stage ${className}`} style={stageStyle}>{children}</div>
      </div>
    </StageContext.Provider>
  )
}

/** Абсолютно позиционированный слой в координатах макета. */
export function Layer({
  box, className = '', style, children, onClick, title, as = 'div',
}: {
  box: StageBox
  className?: string
  style?: CSSProperties
  children?: ReactNode
  onClick?: () => void
  title?: string
  as?: 'div' | 'button'
}) {
  const merged: CSSProperties = {
    position: 'absolute',
    left: box.x, top: box.y, width: box.w, height: box.h,
    ...style,
  }
  if (as === 'button') {
    return (
      <button type="button" className={className} style={merged} onClick={onClick} title={title}>
        {children}
      </button>
    )
  }
  return (
    <div className={className} style={merged} onClick={onClick} title={title}>
      {children}
    </div>
  )
}

/**
 * Надпись из макета. Подменные шрифты имеют другие метрики, поэтому
 * текст ужимается ровно в ту ширину, которая была в PSD, — тогда
 * вёрстка совпадает с макетом при любом шрифте.
 */
export function FitText({
  x, y, w, size, className = '', dy = 0, children, onClick, title, as = 'div', href,
}: {
  x: number; y: number; w: number; size: number
  className?: string; dy?: number
  children: ReactNode
  onClick?: () => void
  title?: string
  as?: 'div' | 'a' | 'button'
  href?: string
}) {
  const ref = useRef<HTMLElement>(null)
  const [k, setK] = useState(1)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let cancelled = false
    const measure = () => {
      if (cancelled || !el) return
      const prev = el.style.transform
      el.style.transform = 'none'
      const natural = el.offsetWidth
      el.style.transform = prev
      if (natural > 0) setK(Math.min(1, w / natural))
    }
    measure()
    if (document.fonts?.ready) void document.fonts.ready.then(measure)
    return () => { cancelled = true }
  }, [w, children])

  const style: CSSProperties = {
    position: 'absolute', left: x, top: y, fontSize: size,
    lineHeight: 1, whiteSpace: 'nowrap', display: 'inline-block',
    transformOrigin: 'left top',
    transform: `translateY(${dy}px) scaleX(${k})`,
  }
  const props = { ref: ref as never, className, style, onClick, title }
  if (as === 'a') return <a {...props} href={href}>{children}</a>
  if (as === 'button') return <button type="button" {...props}>{children}</button>
  return <div {...props}>{children}</div>
}
