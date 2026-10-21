// Политика обработки персональных данных — открыта без входа, на неё ведёт
// галочка согласия при регистрации (правка заказчика 21.10.2026).
import { Link } from 'react-router-dom'
import { POLICY_BLOCKS, POLICY_TITLE } from './politika-text'
import './politika.css'

export function PolitikaPage() {
  return (
    <main className="politika">
      <article className="politika__sheet">
        <h1>{POLICY_TITLE}</h1>
        {POLICY_BLOCKS.map((block, index) => block.kind === 'h'
          ? <h2 key={index}>{block.text}</h2>
          : block.kind === 'li'
            ? <p key={index} className="politika__item">— {block.text}</p>
            : <p key={index}>{block.text}</p>)}
        <p className="politika__back"><Link to="/register">← К регистрации</Link> · <Link to="/login">Вход</Link></p>
      </article>
    </main>
  )
}
