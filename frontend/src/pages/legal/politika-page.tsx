// Юридические документы ООО «АРТЕФАКТУМ» (редакция 08.11.2026): политика,
// согласие, пользовательское соглашение с правилами чата, cookie и push.
// Открыты без входа: на них ведут галочка при регистрации и подвал лендинга,
// и их проверяет Роскомнадзор при подаче в реестр операторов.
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LEGAL_DOCS, LEGAL_ORDER, type LegalSlug } from './legal-docs'
import { CookieChoiceControl } from '../../widgets/cookie-banner/cookie-banner'
import './politika.css'

const SITE = 'https://kooperativ.space'
const LINKS = /(https?:\/\/[^\s,;)»]+[^\s,;)».]|[\w.+-]+@[\w-]+\.[\w.]+[a-z])/gi

/** Ссылки и почта в тексте кликабельны; ссылки на свой сайт ведут внутрь игры. */
function linkify(text: string): ReactNode {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(LINKS)) {
    const value = match[0]
    const at = match.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    if (value.includes('@') && !value.startsWith('http')) parts.push(<a key={at} href={`mailto:${value}`}>{value}</a>)
    else if (value.startsWith(SITE) && value.length > SITE.length + 1) parts.push(<Link key={at} to={value.slice(SITE.length)}>{value}</Link>)
    else parts.push(<a key={at} href={value} target="_blank" rel="noopener noreferrer">{value}</a>)
    last = at + value.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length === 1 ? parts[0] : <>{parts}</>
}

export function LegalPage({ slug }: { slug: LegalSlug }) {
  const doc = LEGAL_DOCS[slug]
  return (
    <main className="politika">
      <article className="politika__sheet">
        <nav className="politika__docs" aria-label="Документы">
          {LEGAL_ORDER.map(key => key === slug
            ? <b key={key} aria-current="page">{LEGAL_DOCS[key].short}</b>
            : <Link key={key} to={`/${key}`}>{LEGAL_DOCS[key].short}</Link>)}
        </nav>
        <h1>{doc.title}</h1>
        <p className="politika__edition">{doc.edition}</p>
        {slug === 'cookies' && <CookieChoiceControl />}
        {doc.blocks.map((block, index) => {
          if (block.kind === 'table') {
            return <div key={index} className="politika__table"><table>
              <thead><tr>{block.head.map(cell => <th key={cell}>{cell}</th>)}</tr></thead>
              <tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{linkify(cell)}</td>)}</tr>)}</tbody>
            </table></div>
          }
          if (block.kind === 'h') return <h2 key={index}>{block.text}</h2>
          if (block.kind === 'li') return <p key={index} className="politika__item">— {linkify(block.text)}</p>
          return <Fragment key={index}><p>{linkify(block.text)}</p></Fragment>
        })}
        <p className="politika__back"><Link to="/register">← К регистрации</Link> · <Link to="/login">Вход</Link></p>
      </article>
    </main>
  )
}

/** Старый адрес политики остаётся: на него ведут ссылки из документов. */
export function PolitikaPage() {
  return <LegalPage slug="politika" />
}
