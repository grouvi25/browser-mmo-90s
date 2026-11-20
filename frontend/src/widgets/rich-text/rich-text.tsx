// Текст разделов, которые пишет администрация (Библиотека, Кодекс, 19.11).
// Разметка простая, чтобы писать без HTML:
//   пустая строка — новый абзац, «## » — подзаголовок, «- » — пункт списка,
//   **так** — жирный, [текст](/school) — ссылка, {{перевес_статов}} — число из игры,
//   строка [[боевые уровни]] — живая таблица.
// HTML не исполняется: всё выводится как текст. Ссылки — только внутри игры или https.
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { LibraryTables } from '../../shared/api/library.api'
import { LIBRARY_BLOCKS, LIBRARY_VARS } from './library-blocks'

const TOKEN = /(\*\*[^*]+\*\*|\[[^\]]+\]\((?:\/|https:\/\/)[^)\s]*\)|\{\{[^}]+\}\})/g

function inline(text: string, tables: LibraryTables | undefined, missingValue: string | undefined): ReactNode[] {
  return text.split(TOKEN).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <b key={i}>{inline(part.slice(2, -2), tables, missingValue)}</b>
    const link = /^\[([^\]]+)\]\(([^)\s]*)\)$/.exec(part)
    if (link) {
      const [, label, href] = link
      return href.startsWith('/')
        ? <Link key={i} to={href}>{label}</Link>
        : <a key={i} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
    }
    const variable = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(part)
    if (variable) {
      const def = LIBRARY_VARS[variable[1]]
      if (!def) return <Fragment key={i}>{part}</Fragment>
      const value = def.value(tables)
      return <Fragment key={i}>{value ?? missingValue ?? `[${def.label}]`}</Fragment>
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}

type Block =
  | { kind: 'h'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'p'; lines: string[] }
  | { kind: 'block'; name: string; raw: string }

export function parseRichText(body: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', lines: para })
    if (list.length) blocks.push({ kind: 'ul', items: list })
    para = []; list = []
  }
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) { flush(); continue }
    const block = /^\[\[\s*(.+?)\s*\]\]$/.exec(line.trim())
    if (block) { flush(); blocks.push({ kind: 'block', name: block[1].toLowerCase(), raw: line.trim() }); continue }
    if (line.startsWith('## ')) { flush(); blocks.push({ kind: 'h', text: line.slice(3).trim() }); continue }
    if (/^[-•] /.test(line)) {
      if (para.length) { blocks.push({ kind: 'p', lines: para }); para = [] }
      list.push(line.slice(2).trim()); continue
    }
    if (list.length) { blocks.push({ kind: 'ul', items: list }); list = [] }
    para.push(line)
  }
  flush()
  return blocks
}

/**
 * tables — данные игры для таблиц и чисел. live: страница игрока (пока грузится,
 * видно «…»); в предпросмотре админки без данных вместо таблицы её название.
 */
export function RichText({ body, tables, live = true, tablesUnavailable = false }: {
  body: string; tables?: LibraryTables; live?: boolean; tablesUnavailable?: boolean
}) {
  const missingValue = live ? (tablesUnavailable ? '—' : '…') : undefined
  return <>{parseRichText(body).map((block, i) => {
    if (block.kind === 'block') {
      const def = LIBRARY_BLOCKS[block.name]
      if (!def) return <p key={i}>{block.raw}</p>
      if (def.playerOnly && !live) return <p key={i} className="library__muted">[{def.label}]</p>
      const out = def.render(tables)
      if (out) return <Fragment key={i}>{out}</Fragment>
      if (tablesUnavailable) return null
      return <p key={i} className="library__muted">{live ? 'Загружаем таблицу…' : `[${def.label}]`}</p>
    }
    if (block.kind === 'h') return <h3 key={i}>{inline(block.text, tables, missingValue)}</h3>
    if (block.kind === 'ul') return <ul key={i}>{block.items.map((item, j) => <li key={j}>{inline(item, tables, missingValue)}</li>)}</ul>
    return <p key={i}>{block.lines.map((line, j) => <Fragment key={j}>{j > 0 && <br />}{inline(line, tables, missingValue)}</Fragment>)}</p>
  })}</>
}
