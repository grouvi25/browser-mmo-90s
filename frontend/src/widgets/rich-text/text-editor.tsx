// Редактор текста для Библиотеки и Кодекса (пользователь 19.11: «сделай
// нормальный редактор»). Кнопки над полем ставят разметку за автора: жирный,
// подзаголовок, список, абзац. Справа сразу видно, как прочтут игроки.
import { useRef, type KeyboardEvent } from 'react'
import { RichText } from './rich-text'
import './text-editor.css'

interface Props {
  value: string
  onChange: (value: string) => void
  maxLength: number
  title?: string
  placeholder?: string
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

/** Новый абзац: пустая строка в месте курсора. */
const paragraph: Edit = (text, start, end) => {
  const before = text.slice(0, start).replace(/\n*$/, '')
  const after = text.slice(end).replace(/^\n*/, '')
  const next = `${before}\n\n${after}`
  return { text: next, start: before.length + 2, end: before.length + 2 }
}

export function TextEditor({ value, onChange, maxLength, title, placeholder }: Props) {
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
        <small className="text-editor__count">{value.length} / {maxLength}</small>
      </div>
      <div className="text-editor__panes">
        <textarea ref={area} value={value} maxLength={maxLength} rows={20} placeholder={placeholder}
          aria-label="Текст раздела" onChange={e => onChange(e.target.value)} onKeyDown={onKey} />
        <div className="text-editor__preview library__text" aria-label="Как увидят игроки">
          {title && <h2>{title}</h2>}
          {value.trim() ? <RichText body={value} /> : <p className="text-editor__empty">Здесь будет текст так, как его увидят игроки.</p>}
        </div>
      </div>
    </div>
  )
}
