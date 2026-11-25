// Подсветка шага обучения (Дима 25.11, образец — обучение RomeWar): всё,
// кроме нужной кнопки, затемнено и не нажимается, вокруг кнопки рамка,
// рядом короткая подсказка со стрелкой. Одна подсказка — одно действие.
//
// Слой рисуется в body, а если кнопка внутри открытого окна (<dialog> или
// своё окно с aria-modal), то в самом окне: иначе окно закрыло бы подсказку.
// Положение пересчитывается каждый кадр — кнопка может уехать при
// прокрутке, смене масштаба сцены или перестройке страницы.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Box { top: number; left: number; width: number; height: number }

/** Окна поверх страницы: <dialog> и свои окна с aria-modal. */
export const MODAL = 'dialog[open], [aria-modal="true"]'

const PAD = 6
const GAP = 14
const EDGE = 12

const same = (a: Box | null, b: Box | null) => !!a && !!b
  && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5
  && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5

interface View { box: Box | null; vw: number; vh: number }

function useTrackedBox(target: Element | null): View {
  const [view, setView] = useState<View>(() => ({ box: null, vw: window.innerWidth, vh: window.innerHeight }))
  useEffect(() => {
    let frame = 0
    let last: View | null = null
    const tick = () => {
      const r = target?.getBoundingClientRect()
      const box = r && r.width > 0 && r.height > 0
        ? { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
        : null
      const next = { box, vw: window.innerWidth, vh: window.innerHeight }
      const changed = !last || last.vw !== next.vw || last.vh !== next.vh
        || (!!last.box !== !!next.box) || (!!box && !same(box, last.box))
      if (changed) { last = next; setView(next) }
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [target])
  return view
}

export function TourSpotlight({ target, title, text, step, onClose, children }: {
  /** Кнопка, которую надо нажать; без неё подсказка стоит посередине экрана. */
  target: Element | null
  title: string
  text: string
  step?: string
  onClose?: () => void
  children?: ReactNode
}) {
  const { box, vw, vh } = useTrackedBox(target)
  const bubble = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ top: number; left: number; arrow: number; below: boolean } | null>(null)

  useLayoutEffect(() => {
    const el = bubble.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (!box) {
      setPlace({ top: Math.max(EDGE, (vh - h) / 2), left: Math.max(EDGE, (vw - w) / 2), arrow: -1, below: true })
      return
    }
    const center = box.left + box.width / 2
    const left = Math.min(Math.max(EDGE, center - w / 2), Math.max(EDGE, vw - w - EDGE))
    const below = box.top + box.height + GAP + h <= vh - EDGE || box.top - GAP - h < EDGE
    const top = below ? box.top + box.height + GAP : box.top - GAP - h
    const arrow = Math.min(Math.max(16, center - left), w - 16)
    setPlace(prev => prev && prev.top === top && prev.left === left && prev.arrow === arrow && prev.below === below
      ? prev : { top, left, arrow, below })
  }, [box, vw, vh, title, text, children])

  const host = (target?.closest(MODAL) as HTMLElement | null) ?? document.body

  return createPortal(
    <div className="tour" data-has-target={box ? '' : undefined}>
      {box ? <>
        {/* Четыре шторки вокруг кнопки: сама кнопка остаётся нажимаемой. */}
        <div className="tour__shade" style={{ top: 0, left: 0, width: vw, height: Math.max(0, box.top) }} />
        <div className="tour__shade" style={{ top: box.top + box.height, left: 0, width: vw, height: Math.max(0, vh - box.top - box.height) }} />
        <div className="tour__shade" style={{ top: box.top, left: 0, width: Math.max(0, box.left), height: box.height }} />
        <div className="tour__shade" style={{ top: box.top, left: box.left + box.width, width: Math.max(0, vw - box.left - box.width), height: box.height }} />
        <div className="tour__ring" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />
      </> : <div className="tour__shade" style={{ inset: 0 }} />}
      <div ref={bubble} className={'tour__bubble' + (place && place.arrow >= 0 ? place.below ? ' is-below' : ' is-above' : '')}
        role="dialog" aria-live="polite" aria-label={title}
        style={place ? { top: place.top, left: place.left, ['--arrow' as string]: `${place.arrow}px` } : { visibility: 'hidden' }}>
        <div className="tour__head">
          <strong>{title}</strong>
          {step && <span className="tour__step">{step}</span>}
          {onClose && <button type="button" className="tour__close" onClick={onClose} aria-label="Скрыть подсказки">×</button>}
        </div>
        <p>{text}</p>
        {children}
      </div>
    </div>,
    host,
  )
}
