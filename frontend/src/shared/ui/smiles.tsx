// =============================================================
// Тематические смайлы чата (правка заказчика 21.10). В тексте сообщения
// смайл хранится кодом «:mobila:» — сервер и старые клиенты видят обычный
// текст, а лента подставляет картинку. Рисунки — tools/art/smiles.cjs.
// =============================================================
import type { ReactNode } from 'react'

const FILES = import.meta.glob('../assets/smiles/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const url = (code: string) => FILES[`../assets/smiles/${code}.svg`]

/** Порядок — как в наборе: сначала вещи эпохи, потом лица. */
export const SMILES: { code: string; name: string }[] = [
  { code: 'mobila', name: 'Мобила' },
  { code: 'pager', name: 'Пейджер' },
  { code: 'kasseta', name: 'Кассета' },
  { code: 'telik', name: 'Телик' },
  { code: 'dendy', name: 'Денди' },
  { code: 'tetris', name: 'Тетрис' },
  { code: 'bablo', name: 'Бабло' },
  { code: 'vaucher', name: 'Ваучер' },
  { code: 'golda', name: 'Голда' },
  { code: 'pidzhak', name: 'Малиновый пиджак' },
  { code: 'devyatka', name: 'Девятка' },
  { code: 'semki', name: 'Семки' },
  { code: 'pivo', name: 'Пиво' },
  { code: 'zhvachka', name: 'Жвачка' },
  { code: 'kastet', name: 'Кастет' },
  { code: 'babochka', name: 'Бабочка' },
  { code: 'braslety', name: 'Браслеты' },
  { code: 'furazhka', name: 'Мусора' },
  { code: 'kachalka', name: 'Качалка' },
  { code: 'respekt', name: 'Респект' },
  { code: 'krutoy', name: 'Крутой' },
  { code: 'bratok', name: 'Браток' },
  { code: 'rzhaka', name: 'Ржака' },
  { code: 'zloy', name: 'Злой' },
].filter(item => url(item.code))

const BY_CODE = new Map(SMILES.map(item => [item.code, item]))
const TOKEN = /:([a-z]+):/g

export const smileToken = (code: string) => `:${code}:`

export function SmileImage({ code, className = 'smile' }: { code: string; className?: string }) {
  const item = BY_CODE.get(code)
  if (!item) return null
  return <img className={className} src={url(code)} alt={item.name} title={item.name} draggable={false} />
}

/** Текст сообщения с картинками вместо известных кодов; незнакомые остаются текстом. */
export function withSmiles(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(TOKEN)) {
    if (!BY_CODE.has(match[1])) continue
    const at = match.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    out.push(<SmileImage key={at} code={match[1]} />)
    last = at + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
