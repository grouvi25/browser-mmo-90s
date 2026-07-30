// =============================================================
// Спрайты макета: картинки, вырезанные из PSD отдельными слоями.
// Всё, что кликается, подсвечивается или меняется, живёт здесь,
// а не запечено в подложку.
// =============================================================
import type { CSSProperties, ReactNode } from 'react'
import type { StageBox } from '../lib/stage'

const pngs = import.meta.glob('../assets/ui/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const webps = import.meta.glob('../assets/ui/*.webp', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

function toMap(src: Record<string, string>, ext: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, url] of Object.entries(src)) {
    const name = path.split('/').pop()!.replace(ext, '')
    out[name] = url
  }
  return out
}

export const SPRITES = toMap(pngs, '.png')
export const PLATES = toMap(webps, '.webp')

export function spriteUrl(name: string): string | undefined {
  return SPRITES[name]
}

interface SpriteProps {
  name: string
  box: StageBox
  className?: string
  style?: CSSProperties
  alt?: string
}

/** Неинтерактивная картинка на сцене. */
export function Sprite({ name, box, className = '', style, alt = '' }: SpriteProps) {
  const url = SPRITES[name]
  if (!url) return null
  return (
    <img
      src={url}
      alt={alt}
      draggable={false}
      className={`sprite ${className}`}
      style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, ...style }}
    />
  )
}

interface HotspotProps {
  box: StageBox
  onClick?: () => void
  title?: string
  className?: string
  disabled?: boolean
  active?: boolean
  children?: ReactNode
  style?: CSSProperties
}

/**
 * Кликабельная область сцены. Подсветка делается фильтром по
 * содержимому — сама картинка при этом не дублируется.
 */
export function Hotspot({
  box, onClick, title, className = '', disabled, active, children, style,
}: HotspotProps) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`hotspot ${active ? 'is-active' : ''} ${className}`}
      style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, ...style }}
    >
      {children}
    </button>
  )
}

/** Кликабельный спрайт: картинка + область нажатия одним элементом. */
export function SpriteButton({
  name, box, onClick, title, active, disabled, className = '', empty,
}: SpriteProps & {
  onClick?: () => void
  title?: string
  active?: boolean
  disabled?: boolean
  /** нечего показывать — рисуем пустой слот */
  empty?: boolean
}) {
  const url = SPRITES[name]
  return (
    <Hotspot box={box} onClick={onClick} title={title} active={active}
      disabled={disabled} className={`sprite-btn ${className}`}>
      {!empty && url && (
        <img src={url} alt="" draggable={false} className="sprite-btn__img" />
      )}
      {empty && <span className="sprite-btn__empty" />}
    </Hotspot>
  )
}
