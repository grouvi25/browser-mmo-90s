// Хроника под полем. Поле держит пропорцию 3280:1798 и на широком экране
// упирается в ширину колонки — снизу остаётся пустая полоса бумаги.
// Туда и кладём последние события: игрок видит, чем кончился прошлый ход,
// не открывая лог.
import { useEffect, useRef } from 'react'
import { EventIcon, getEvent, type RoundRecord } from './battle-events'

interface BattleChronicleProps {
  rounds: RoundRecord[]
  playerName: string
  enemyName: string
  onOpenLog: () => void
}

export function BattleChronicle({ rounds, playerName, enemyName, onOpenLog }: BattleChronicleProps) {
  const tail = useRef<HTMLOListElement>(null)
  const lines = rounds.flatMap(round => round.events.map((event, index) => ({
    key: `${round.round}-${index}`, round: round.round, event, at: round.at,
  })))
  // Время в начале строки — как набрано в макете: «[16:31] …».
  const clock = (at?: number) => {
    if (!at) return null
    const d = new Date(at)
    return `[${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}]`
  }
  // Прокручиваем к свежему: список растёт вниз, как в мессенджере.
  useEffect(() => { tail.current?.scrollTo({ top: tail.current.scrollHeight }) }, [lines.length])

  return <section className="battle-chronicle" aria-label="Хроника боя">
    <header>
      <b>Хроника</b>
      <button type="button" onClick={onOpenLog}>весь лог</button>
    </header>
    {lines.length === 0
      ? <p className="battle-chronicle__empty">Бой только начался — событий пока нет.</p>
      : <ol ref={tail}>
        {lines.map(line => {
          const view = getEvent(line.event)
          const mine = line.event.actor === 'player'
          return <li key={line.key} className={mine ? 'is-mine' : 'is-theirs'}>
            <i className="battle-chronicle__clock">{clock(line.at) ?? line.round}</i>
            <span className="battle-chronicle__icon" style={{ color: view.color }}><EventIcon type={view.type} size={10} /></span>
            <b>{mine ? playerName : enemyName}</b>
            {/* Цвет берём из таблицы стилей, а не из события: те тона
                рассчитаны на тёмную плашку и на бумаге не читаются. */}
            <span className={`battle-chronicle__label is-${view.type}`}>{view.label}</span>
            {line.event.finalDamage > 0 && <em>−{line.event.finalDamage}</em>}
          </li>
        })}
      </ol>}
  </section>
}
