// Текст разделов, которые пишет администрация (Библиотека, Кодекс, 19.11).
// Разметка простая, чтобы писать без HTML: пустая строка — новый абзац,
// «## » — подзаголовок, «- » — пункт списка, **так** — жирный. HTML не
// исполняется: всё выводится как текст.
import { Fragment, type ReactNode } from 'react'

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <b key={i}>{part.slice(2, -2)}</b>
      : <Fragment key={i}>{part}</Fragment>)
}

type Block = { kind: 'h'; text: string } | { kind: 'ul'; items: string[] } | { kind: 'p'; lines: string[] }

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

export function RichText({ body }: { body: string }) {
  return <>{parseRichText(body).map((block, i) => {
    if (block.kind === 'h') return <h3 key={i}>{inline(block.text)}</h3>
    if (block.kind === 'ul') return <ul key={i}>{block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</ul>
    return <p key={i}>{block.lines.map((line, j) => <Fragment key={j}>{j > 0 && <br />}{inline(line)}</Fragment>)}</p>
  })}</>
}
