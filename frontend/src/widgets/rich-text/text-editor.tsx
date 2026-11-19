// Редактор текста для Библиотеки и Кодекса (пользователь 19.11: «сделай
// нормальный редактор»). Кнопки над полем ставят разметку за автора: жирный,
// подзаголовок, список, абзац. Справа сразу видно, как прочтут игроки.
import { useRef, type KeyboardEvent } from 'react'
import { RichText } from './rich-text'
import { LIBRARY_BLOCKS, LIBRARY_VARS } from './library-blocks'
import type { LibraryTables } from '../../shared/api/library.api'
import { askText } from '../ask-text/ask-text'
import './text-editor.css'

interface Props {
  value: string
  onChange: (value: string) => void
  maxLength: number
  title?: string
  placeholder?: string
  /** Данные игры для предпросмотра таблиц и чисел. */
  tables?: LibraryTables
}

type Edit = (text: string, start: number, end: number) => { text: string; start: number; end: number }

/** Обернуть выделение: **жирный**. Без выделения — вставить заготовку и выделить её. */
const wrapBold: Edit = (text, start, end) => {
  const picked = text.slice(start, end) || 'жирный текст'
  const already = text.slice(start - 2, start) === '**' && text.slice(end, end + 2) === '**'
  if (already) return { text: text.slice(0, start - 2) + picked + text.slice(end + 2), start: start - 2, end: start - 2 + picked.length }
  const next = text.slice(0, start) + `**${picked}**` + text.slice(end)
  return { text: next, start: start + 2, end: start + 2 + picked.length }
}

/** Отметить строки выделения приставкой («## », «- »); повторное нажатие снимает её. */
const linePrefix = (prefix: string): Edit => (text, start, end) => {
  const from = text.lastIndexOf('\n', start - 1) + 1
  const toBreak = text.indexOf('\n', end)
  const to = toBreak === -1 ? text.length : toBreak
  const lines = text.slice(from, to).split('\n')
  const all = lines.every(line => line.startsWith(prefix))
  const changed = lines.map(line => all ? line.slice(prefix.length) : line.startsWith(prefix) ? line : prefix + line.replace(/^(## |- )/, '')).join('\n')
  return { text: text.slice(0, from) + changed + text.slice(to), start: from, end: from + changed.length }
}

/** Вставить кусок в место курсора (вместо выделения). Блок — отдельной строкой с пустыми вокруг. */
const insert = (piece: string, ownLine = false): Edit => (text, start, end) => {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const NL = String.fromCharCode(10)
  let lead = ''
  if (ownLine && before && !before.endsWith(NL + NL)) lead = before.endsWith(NL) ? NL : NL + NL
  const chunk = ownLine ? lead + piece + NL + NL : piece
  const rest = ownLine ? after.replace(/^\n+/, '') : after
  const next = before + chunk + rest
  return { text: next, start: before.length + chunk.length, end: before.length + chunk.length }
}

/** Новый абзац: пустая строка в месте курсора. */
const paragraph: Edit = (text, start, end) => {
  const before = text.slice(0, start).replace(/\n*$/, '')
  const after = text.slice(end).replace(/^\n*/, '')
  const next = `${before}\n\n${after}`
  return { text: next, start: before.length + 2, end: before.length + 2 }
}

export function TextEditor({ value, onChange, maxLength, title, placeholder, tables }: Props) {
  const area = useRef<HTMLTextAreaElement>(null)

  const apply = (edit: Edit) => {
    const el = area.current
    if (!el) return
    const result = edit(value, el.selectionStart, el.selectionEnd)
    if (result.text.length > maxLength) return
    onChange(result.text)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(result.start, result.end) })
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return
    const key = event.key.toLowerCase()
    if (key === 'b' || key === 'и') { event.preventDefault(); apply(wrapBold) }
  }

  return (
    <div className="text-editor">
      <div className="text-editor__bar" role="toolbar" aria-label="Оформление текста">
        <button type="button" onClick={() => apply(wrapBold)} title="Жирный (Ctrl+B)"><b>Ж</b></button>
        <button type="button" onClick={() => apply(linePrefix('## '))} title="Подзаголовок">Подзаголовок</button>
        <button type="button" onClick={() => apply(linePrefix('- '))} title="Список">• Список</button>
        <button type="button" onClick={() => apply(paragraph)} title="Новый абзац">¶ Абзац</button>
        <button type="button" title="Ссылка на место в игре" onClick={async () => {
          const el = area.current
          const picked = el ? value.slice(el.selectionStart, el.selectionEnd) : ''
          const path = await askText('Куда ведет ссылка? Адрес в игре, например /school, или https://…', '/', { maxLength: 200 })
          if (!path || !(path.startsWith('/') || path.startsWith('https://'))) return
          const label = picked || await askText('Текст ссылки', 'Училище', { maxLength: 80 })
          if (label) apply(insert(`[${label}](${path.trim()})`))
        }}>Ссылка</button>
        <select aria-label="Вставить таблицу из игры" value="" onChange={e => { if (e.target.value) apply(insert(`[[${e.target.value}]]`, true)) }}>
          <option value="">Таблица…</option>
          {Object.entries(LIBRARY_BLOCKS).map(([key, def]) => <option key={key} value={key}>{def.label}</option>)}
        </select>
        <select aria-label="Вставить число из игры" value="" onChange={e => { if (e.target.value) apply(insert(`{{${e.target.value}}}`)) }}>
          <option value="">Число…</option>
          {Object.entries(LIBRARY_VARS).map(([key, def]) => <option key={key} value={key}>{def.label}</option>)}
        </select>
        <small className="text-editor__count">{value.length} / {maxLength}</small>
      </div>
      <div className="text-editor__panes">
        <textarea ref={area} value={value} maxLength={maxLength} rows={20} placeholder={placeholder}
          aria-label="Текст раздела" onChange={e => onChange(e.target.value)} onKeyDown={onKey} />
        <div className="text-editor__preview library__text" aria-label="Как увидят игроки">
          {title && <h2>{title}</h2>}
          {value.trim() ? <RichText body={value} tables={tables} live={false} /> : <p className="text-editor__empty">Здесь будет текст так, как его увидят игроки.</p>}
        </div>
      </div>
    </div>
  )
}
